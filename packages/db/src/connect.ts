import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import SQLite from 'better-sqlite3';
import { Kysely, PostgresDialect, SqliteDialect } from 'kysely';
import pg from 'pg';
import type { DatabaseDialect } from '@inventory/shared';
import type { Database } from './schema.ts';
import { parseDatabaseUrl } from './url.ts';

export interface DatabaseConnection {
	db: Kysely<Database>;
	dialect: DatabaseDialect;
	close: () => Promise<void>;
}

// Postgres returns BIGINT (int8, OID 20) as strings by default. All quantities are
// BIGINT base units (plan §3.4) and stay well within the safe integer range.
const INT8_OID = 20;
pg.types.setTypeParser(INT8_OID, (value) => {
	const n = Number(value);
	if (!Number.isSafeInteger(n)) throw new RangeError(`int8 value ${value} exceeds safe integer`);
	return n;
});

export function connect(databaseUrl: string): DatabaseConnection {
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
		return { db, dialect: 'sqlite', close: () => db.destroy() };
	}

	const pool = new pg.Pool({ connectionString: target.connectionString, max: 10 });
	const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
	return { db, dialect: 'postgres', close: () => db.destroy() };
}
