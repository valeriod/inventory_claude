import { sql } from 'kysely';
import type { DatabaseConnection } from './connect.ts';
import { InvalidOperationError } from './errors.ts';
import { getMigrations } from './migrations/index.ts';
import type { Database } from './schema.ts';

/**
 * Full export / import of the database as JSON (plan §8.2): the data export in Settings, and
 * `pnpm db:transfer` for moving between SQLite and Postgres or restoring a JSON backup. Rows are
 * copied as stored (ids, timestamps, history), so a restore is an exact copy.
 */

export const DUMP_FORMAT = 'inventory-dump';
export const DUMP_VERSION = 1;

/** Tables in foreign-key order, with the columns that are copied (generated columns excluded). */
const TABLES = {
	categories: [
		'id',
		'name',
		'parent_id',
		'sku_prefix',
		'sku_seq',
		'unit_kind',
		'display_unit',
		'field_defs',
		'created_at',
		'updated_at'
	],
	locations: ['id', 'name', 'parent_id', 'code', 'description', 'created_at', 'updated_at'],
	projects: ['id', 'name', 'description', 'status', 'created_at', 'updated_at'],
	items: [
		'sku',
		'category_id',
		'name',
		'description',
		'qty_on_hand',
		'qty_min',
		'location_id',
		'barcode',
		'attributes',
		'search_text',
		'version',
		'archived_at',
		'created_at',
		'updated_at'
	],
	project_parts: ['id', 'project_id', 'sku', 'qty_needed', 'note', 'created_at', 'updated_at'],
	reservations: [
		'id',
		'project_id',
		'sku',
		'qty_reserved',
		'status',
		'note',
		'created_at',
		'updated_at'
	],
	stock_movements: [
		'id',
		'sku',
		'delta',
		'reason',
		'project_id',
		'reservation_id',
		'note',
		'created_at'
	]
} as const;

type TableName = keyof typeof TABLES;
const TABLE_NAMES = Object.keys(TABLES) as TableName[];
const JSON_COLUMNS: Partial<Record<TableName, string[]>> = {
	categories: ['field_defs'],
	items: ['attributes']
};
/** Tables with an identity/autoincrement `id`. */
const ID_TABLES: TableName[] = [
	'categories',
	'locations',
	'projects',
	'project_parts',
	'reservations',
	'stock_movements'
];

export type DumpRow = Record<string, unknown>;

export interface Dump {
	format: typeof DUMP_FORMAT;
	version: typeof DUMP_VERSION;
	exportedAt: string;
	/** Latest migration of the source database. */
	schema: string;
	tables: Record<TableName, DumpRow[]>;
}

function latestMigration(conn: DatabaseConnection): string {
	return Object.keys(getMigrations(conn.dialect)).sort().at(-1)!;
}

export async function dumpDatabase(conn: DatabaseConnection): Promise<Dump> {
	const tables = {} as Record<TableName, DumpRow[]>;
	for (const table of TABLE_NAMES) {
		const columns = TABLES[table];
		const rows = (await conn.db
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			.selectFrom(table as any)
			.select(columns as unknown as string[])
			.orderBy(table === 'items' ? 'sku' : 'id')
			.execute()) as DumpRow[];
		for (const row of rows) {
			for (const column of JSON_COLUMNS[table] ?? []) {
				row[column] = conn.adapter.parseJson(row[column]);
			}
		}
		tables[table] = rows;
	}
	return {
		format: DUMP_FORMAT,
		version: DUMP_VERSION,
		exportedAt: new Date().toISOString(),
		schema: latestMigration(conn),
		tables
	};
}

/** Parents before children, so self-referencing foreign keys are satisfied on insert. */
function parentsFirst(rows: DumpRow[]): DumpRow[] {
	const byId = new Map(rows.map((r) => [r.id, r]));
	const out: DumpRow[] = [];
	const placed = new Set<unknown>();
	const visit = (row: DumpRow, path: Set<unknown>) => {
		if (placed.has(row.id)) return;
		if (path.has(row.id)) throw new InvalidOperationError('The dump contains a parent cycle');
		path.add(row.id);
		const parent = row.parent_id === null ? undefined : byId.get(row.parent_id);
		if (parent) visit(parent, path);
		placed.add(row.id);
		out.push(row);
	};
	for (const row of rows) visit(row, new Set());
	return out;
}

export function assertDump(value: unknown): asserts value is Dump {
	const dump = value as Partial<Dump> | null;
	if (!dump || dump.format !== DUMP_FORMAT || typeof dump.tables !== 'object') {
		throw new InvalidOperationError('Not an inventory export file');
	}
	if (dump.version !== DUMP_VERSION) {
		throw new InvalidOperationError(`Unsupported export version ${String(dump.version)}`);
	}
}

/**
 * Load a dump into a migrated, empty database (one transaction). Refuses to touch a database
 * that already has categories or items.
 */
export async function restoreDatabase(
	conn: DatabaseConnection,
	dump: unknown
): Promise<Record<TableName, number>> {
	assertDump(dump);
	const counts = {} as Record<TableName, number>;
	await conn.db.transaction().execute(async (trx) => {
		for (const table of ['categories', 'items'] as const) {
			const { n } = await trx
				.selectFrom(table)
				.select(sql<number>`count(*)`.as('n'))
				.executeTakeFirstOrThrow();
			if (Number(n) > 0) {
				throw new InvalidOperationError(
					'The target database is not empty; restore into a new, empty database'
				);
			}
		}
		for (const table of TABLE_NAMES) {
			let rows = dump.tables[table] ?? [];
			if (table === 'categories' || table === 'locations') rows = parentsFirst(rows);
			const columns = TABLES[table] as readonly string[];
			for (let i = 0; i < rows.length; i += 200) {
				const values = rows.slice(i, i + 200).map((row) => {
					const out: Record<string, unknown> = {};
					for (const column of columns) {
						const value = row[column] ?? null;
						out[column] = JSON_COLUMNS[table]?.includes(column) ? conn.adapter.json(value) : value;
					}
					return out;
				});
				// Table and columns come from TABLES above, not from the dump.
				await trx
					.insertInto(table as keyof Database)
					.values(values as never)
					.execute();
			}
			counts[table] = rows.length;
		}
		if (conn.dialect === 'postgres') {
			// Identity columns do not advance on explicit ids; move them past the copied rows.
			for (const table of ID_TABLES) {
				await sql`select setval(pg_get_serial_sequence(${table}, 'id'),
					coalesce((select max(id) from ${sql.table(table)}), 0) + 1, false)`.execute(trx);
			}
		}
	});
	return counts;
}

/** SQLite: write a consistent, compact copy of the database to `file` (`VACUUM INTO`). */
export async function vacuumInto(conn: DatabaseConnection, file: string): Promise<void> {
	if (conn.dialect !== 'sqlite') throw new InvalidOperationError('VACUUM INTO is SQLite only');
	await sql`vacuum into ${file}`.execute(conn.db);
}
