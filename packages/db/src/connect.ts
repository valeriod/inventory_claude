import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import SQLite from 'better-sqlite3';
import { Kysely, PostgresDialect, SqliteDialect } from 'kysely';
import pg from 'pg';
import type { DatabaseDialect } from '@inventory/shared';
import { adapterFor, type DialectAdapter } from './dialect.ts';
import type { Database } from './schema.ts';
import { parseDatabaseUrl } from './url.ts';

export interface DatabaseConnection {
	db: Kysely<Database>;
	dialect: DatabaseDialect;
	adapter: DialectAdapter;
	close: () => Promise<void>;
}

export interface ConnectOptions {
	/** Postgres only: schema to use via search_path (used to isolate test runs). */
	schema?: string;
}

// Postgres returns BIGINT (int8) as strings by default. All quantities are BIGINT base units
// (plan §3.4) and stay well within the safe integer range.
const INT8_OID = 20;
pg.types.setTypeParser(INT8_OID, (value) => {
	const n = Number(value);
	if (!Number.isSafeInteger(n)) throw new RangeError(`int8 value ${value} exceeds safe integer`);
	return n;
});

// timestamptz → ISO-8601 string, matching how timestamps are stored on SQLite.
const TIMESTAMPTZ_OID = 1184;
const parseTimestamptz = pg.types.getTypeParser(TIMESTAMPTZ_OID);
pg.types.setTypeParser(TIMESTAMPTZ_OID, (value) => {
	const parsed: unknown = parseTimestamptz(value);
	return parsed instanceof Date ? parsed.toISOString() : parsed;
});

const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export function connect(databaseUrl: string, options: ConnectOptions = {}): DatabaseConnection {
	const target = parseDatabaseUrl(databaseUrl);

	if (target.dialect === 'sqlite') {
		if (target.filename !== ':memory:') {
			mkdirSync(dirname(target.filename), { recursive: true });
		}
		const sqlite = new SQLite(target.filename);
		sqlite.pragma('journal_mode = WAL');
		sqlite.pragma('foreign_keys = ON');
		sqlite.pragma('busy_timeout = 5000');
		const db = new Kysely<Database>({ dialect: new SqliteDialect({ database: sqlite }) });
		return { db, dialect: 'sqlite', adapter: adapterFor('sqlite'), close: () => db.destroy() };
	}

	if (options.schema !== undefined && !SCHEMA_NAME.test(options.schema)) {
		throw new Error(`Invalid schema name ${JSON.stringify(options.schema)}`);
	}
	const pool = new pg.Pool({
		connectionString: target.connectionString,
		max: 10,
		...(options.schema ? { options: `-c search_path=${options.schema}` } : {})
	});
	const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
	return { db, dialect: 'postgres', adapter: adapterFor('postgres'), close: () => db.destroy() };
}
