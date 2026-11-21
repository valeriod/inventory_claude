import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, type DatabaseConnection } from './connect.ts';
import { migrateToLatest } from './migrate.ts';

// Runs against SQLite in memory by default; CI also runs it with TEST_DATABASE_URL=postgres://…
const url = process.env.TEST_DATABASE_URL ?? 'sqlite::memory:';

describe(`database connection (${url.split(':')[0]})`, () => {
	let conn: DatabaseConnection;

	beforeAll(() => {
		conn = connect(url);
	});

	afterAll(async () => {
		await conn?.close();
	});

	it('reports the expected dialect', () => {
		expect(conn.dialect).toBe(url.startsWith('sqlite') ? 'sqlite' : 'postgres');
	});

	it('executes a query', async () => {
		const { rows } = await sql<{ one: number }>`select 1 as one`.execute(conn.db);
		expect(Number(rows[0]?.one)).toBe(1);
	});

	it('supports JSON field extraction', async () => {
		const doc = JSON.stringify({ color: 'red', gauge_awg: 22 });
		const query =
			conn.dialect === 'sqlite'
				? sql<{ color: string }>`select json_extract(${doc}, '$.color') as color`
				: sql<{ color: string }>`select (${doc}::jsonb)->>'color' as color`;
		const { rows } = await query.execute(conn.db);
		expect(rows[0]?.color).toBe('red');
	});

	it('round-trips 64-bit integers as numbers', async () => {
		const big = 9_000_000_000_000; // 9 billion metres in mm
		const query =
			conn.dialect === 'sqlite'
				? sql<{ n: number }>`select cast(${big} as integer) as n`
				: sql<{ n: number }>`select ${big}::bigint as n`;
		const { rows } = await query.execute(conn.db);
		expect(rows[0]?.n).toBe(big);
	});

	it('runs migrations', async () => {
		await expect(migrateToLatest(conn)).resolves.toBeInstanceOf(Array);
	});
});
