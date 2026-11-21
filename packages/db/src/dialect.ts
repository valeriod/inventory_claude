import { sql, type QueryExecutorProvider, type RawBuilder, type SqlBool } from 'kysely';
import { FIELD_KEY_PATTERN, type DatabaseDialect } from '@inventory/shared';
import { queryTokens } from './search.ts';

export type JsonCast = 'text' | 'number' | 'boolean';
export type ScalarValue = string | number | boolean;
export type ConstraintKind = 'unique' | 'foreign_key' | 'check';

/**
 * Every SQL difference between SQLite and Postgres lives here (plan §3.5).
 * Repositories never write dialect-specific SQL directly.
 */
export interface DialectAdapter {
	readonly dialect: DatabaseDialect;
	/** Whether `SELECT … FOR UPDATE` is supported (SQLite serializes writers instead). */
	readonly supportsRowLocks: boolean;
	/** Bind a value for a JSON column. */
	json(value: unknown): RawBuilder<unknown>;
	/** Read a JSON column value as returned by the driver. */
	parseJson<T>(raw: unknown): T;
	/** Extract `column.key`; non-matching JSON types yield NULL instead of a cast error. */
	jsonField(column: string, key: string, cast?: JsonCast): RawBuilder<unknown>;
	/** `column.key = value` for scalar values. */
	jsonEquals(column: string, key: string, value: ScalarValue): RawBuilder<SqlBool>;
	/** `column.key` is an array containing `value` (multi_enum fields). */
	jsonArrayContains(column: string, key: string, value: string): RawBuilder<SqlBool>;
	/** Prefix full-text match against items; null when the query has no searchable tokens. */
	itemTextMatch(query: string): RawBuilder<SqlBool> | null;
	/** Create an expression index matching `jsonField(…, cast)` for fast filtering/sorting. */
	ensureFieldIndex(db: QueryExecutorProvider, key: string, cast?: JsonCast): Promise<void>;
	/** Classify a driver error as a constraint violation, if it is one. */
	constraintViolation(err: unknown): ConstraintKind | null;
}

function assertKey(key: string): string {
	if (!FIELD_KEY_PATTERN.test(key))
		throw new Error(`Invalid attribute key: ${JSON.stringify(key)}`);
	return key;
}

function errorCode(err: unknown): string | undefined {
	if (typeof err === 'object' && err !== null && 'code' in err) {
		const code = (err as { code: unknown }).code;
		return typeof code === 'string' ? code : undefined;
	}
	return undefined;
}

const sqliteAdapter: DialectAdapter = {
	dialect: 'sqlite',
	supportsRowLocks: false,

	json: (value) => sql`${JSON.stringify(value)}`,

	parseJson: <T>(raw: unknown) => (typeof raw === 'string' ? JSON.parse(raw) : raw) as T,

	jsonField(column, key, cast = 'text') {
		const col = sql.ref(column);
		const path = sql.lit(`$.${assertKey(key)}`);
		switch (cast) {
			case 'text':
				return sql`json_extract(${col}, ${path})`;
			case 'number':
				return sql`(case when json_type(${col}, ${path}) in ('integer', 'real') then json_extract(${col}, ${path}) end)`;
			case 'boolean':
				return sql`(case when json_type(${col}, ${path}) in ('true', 'false') then json_extract(${col}, ${path}) end)`;
		}
	},

	jsonEquals(column, key, value) {
		const col = sql.ref(column);
		const path = sql.lit(`$.${assertKey(key)}`);
		if (typeof value === 'boolean') {
			return sql<SqlBool>`json_type(${col}, ${path}) = ${value ? 'true' : 'false'}`;
		}
		if (typeof value === 'number') {
			return sql<SqlBool>`(json_type(${col}, ${path}) in ('integer', 'real') and json_extract(${col}, ${path}) = ${value})`;
		}
		return sql<SqlBool>`(json_type(${col}, ${path}) = 'text' and json_extract(${col}, ${path}) = ${value})`;
	},

	jsonArrayContains(column, key, value) {
		const path = sql.lit(`$.${assertKey(key)}`);
		return sql<SqlBool>`exists (select 1 from json_each(${sql.ref(column)}, ${path}) as je where je.type = 'text' and je.value = ${value})`;
	},

	itemTextMatch(query) {
		const tokens = queryTokens(query);
		if (tokens.length === 0) return null;
		// Tokens are [\p{L}\p{N}]+ only, so quoting them is safe. "tok"* = prefix match.
		const match = tokens.map((t) => `"${t}"*`).join(' ');
		return sql<SqlBool>`${sql.ref('items.sku')} in (select sku from items_fts where items_fts match ${match})`;
	},

	async ensureFieldIndex(db, key, cast = 'text') {
		const name = sql.id(`items_attr_${assertKey(key)}_${cast}`);
		await sql`create index if not exists ${name} on items (${this.jsonField('attributes', key, cast)})`.execute(
			db
		);
	},

	constraintViolation(err) {
		switch (errorCode(err)) {
			case 'SQLITE_CONSTRAINT_UNIQUE':
			case 'SQLITE_CONSTRAINT_PRIMARYKEY':
				return 'unique';
			case 'SQLITE_CONSTRAINT_FOREIGNKEY':
				return 'foreign_key';
			case 'SQLITE_CONSTRAINT_TRIGGER':
				// ON DELETE RESTRICT violations are reported with the TRIGGER code.
				return err instanceof Error && err.message.includes('FOREIGN KEY') ? 'foreign_key' : null;
			case 'SQLITE_CONSTRAINT_CHECK':
				return 'check';
			default:
				return null;
		}
	}
};

const postgresAdapter: DialectAdapter = {
	dialect: 'postgres',
	supportsRowLocks: true,

	json: (value) => sql`cast(${JSON.stringify(value)} as jsonb)`,

	// node-postgres already parses jsonb.
	parseJson: <T>(raw: unknown) => raw as T,

	jsonField(column, key, cast = 'text') {
		const col = sql.ref(column);
		const k = sql.lit(assertKey(key));
		switch (cast) {
			case 'text':
				return sql`(${col} ->> ${k})`;
			case 'number':
				return sql`(case when jsonb_typeof(${col} -> ${k}) = 'number' then (${col} ->> ${k})::double precision end)`;
			case 'boolean':
				return sql`(case when jsonb_typeof(${col} -> ${k}) = 'boolean' then (${col} ->> ${k})::boolean end)`;
		}
	},

	jsonEquals(column, key, value) {
		// Containment uses the GIN index on items.attributes.
		const doc = JSON.stringify({ [assertKey(key)]: value });
		return sql<SqlBool>`${sql.ref(column)} @> cast(${doc} as jsonb)`;
	},

	jsonArrayContains(column, key, value) {
		const doc = JSON.stringify({ [assertKey(key)]: [value] });
		return sql<SqlBool>`${sql.ref(column)} @> cast(${doc} as jsonb)`;
	},

	itemTextMatch(query) {
		const tokens = queryTokens(query);
		if (tokens.length === 0) return null;
		const tsquery = tokens.map((t) => `${t}:*`).join(' & ');
		return sql<SqlBool>`${sql.ref('items.search_vector')} @@ to_tsquery('simple', ${tsquery})`;
	},

	async ensureFieldIndex(db, key, cast = 'text') {
		const name = sql.id(`items_attr_${assertKey(key)}_${cast}`);
		await sql`create index if not exists ${name} on items (${this.jsonField('attributes', key, cast)})`.execute(
			db
		);
	},

	constraintViolation(err) {
		switch (errorCode(err)) {
			case '23505':
				return 'unique';
			case '23503': // foreign_key_violation
			case '23001': // restrict_violation (ON DELETE RESTRICT)
				return 'foreign_key';
			case '23514':
				return 'check';
			default:
				return null;
		}
	}
};

export function adapterFor(dialect: DatabaseDialect): DialectAdapter {
	return dialect === 'sqlite' ? sqliteAdapter : postgresAdapter;
}
