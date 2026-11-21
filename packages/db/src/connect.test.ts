import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { migrateToEmpty, migrateToLatest } from './migrate.ts';
import type { TestDatabase } from './testing.ts';
import { useTestDatabase } from './test-helpers.ts';

const CORE_TABLES = [
	'categories',
	'locations',
	'projects',
	'items',
	'reservations',
	'stock_movements'
];

/** Resolves through the connection's search_path, unlike introspection (which lists all schemas). */
async function tableExists(conn: TestDatabase, name: string): Promise<boolean> {
	const query =
		conn.dialect === 'sqlite'
			? sql<{
					found: number;
				}>`select count(*) as found from sqlite_master where type = 'table' and name = ${name}`
			: sql<{
					found: number;
				}>`select count(*) as found from pg_tables where schemaname = current_schema() and tablename = ${name}`;
	const { rows } = await query.execute(conn.db);
	return Number(rows[0]?.found) > 0;
}

describe('database connection and migrations', () => {
	const fx = useTestDatabase();

	it('executes a query', async () => {
		const { rows } = await sql<{ one: number }>`select 1 as one`.execute(fx().db.db);
		expect(Number(rows[0]?.one)).toBe(1);
	});

	it('round-trips 64-bit integers as numbers', async () => {
		const big = 9_000_000_000_000;
		const { db, dialect } = fx().db;
		const query =
			dialect === 'sqlite'
				? sql<{ n: number }>`select cast(${big} as integer) as n`
				: sql<{ n: number }>`select ${big}::bigint as n`;
		const { rows } = await query.execute(db);
		expect(rows[0]?.n).toBe(big);
	});

	it('creates all core tables', async () => {
		for (const table of CORE_TABLES) expect(await tableExists(fx().db, table)).toBe(true);
	});

	it('is idempotent and reversible', async () => {
		const conn = fx().db;
		expect(await migrateToLatest(conn)).toEqual([]);
		const down = await migrateToEmpty(conn);
		expect(down.every((r) => r.status === 'Success')).toBe(true);
		for (const table of CORE_TABLES) expect(await tableExists(conn, table)).toBe(false);
		expect(await migrateToLatest(conn)).toHaveLength(1);
	});

	it('enforces foreign keys', async () => {
		const { db, adapter } = fx().db;
		const now = new Date().toISOString();
		const err = await db
			.insertInto('items')
			.values({
				sku: 'X-1',
				category_id: 999,
				name: 'Orphan',
				attributes: adapter.json({}),
				search_text: '',
				created_at: now,
				updated_at: now
			})
			.execute()
			.catch((e: unknown) => e);
		expect(adapter.constraintViolation(err)).toBe('foreign_key');
	});
});
