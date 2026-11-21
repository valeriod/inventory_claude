import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { connect, type DatabaseConnection } from './connect.ts';
import { migrateToLatest } from './migrate.ts';
import { parseDatabaseUrl } from './url.ts';

export interface TestDatabase extends DatabaseConnection {
	/** Close the connection and drop the isolated schema (Postgres). */
	cleanup: () => Promise<void>;
}

/**
 * A fresh, migrated database for one test file.
 * TEST_DATABASE_URL selects the dialect (default: in-memory SQLite). On Postgres, each call gets
 * its own schema so test files can run in parallel against one database.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
	const url = process.env.TEST_DATABASE_URL ?? 'sqlite::memory:';
	const target = parseDatabaseUrl(url);

	if (target.dialect === 'sqlite') {
		const conn = connect(url);
		await migrateToLatest(conn);
		return { ...conn, cleanup: conn.close };
	}

	const schema = `test_${randomBytes(6).toString('hex')}`;
	const admin = new pg.Client({ connectionString: target.connectionString });
	await admin.connect();
	try {
		await admin.query(`create schema ${schema}`);
	} finally {
		await admin.end();
	}

	const conn = connect(url, { schema });
	await migrateToLatest(conn);
	return {
		...conn,
		cleanup: async () => {
			await conn.close();
			const dropper = new pg.Client({ connectionString: target.connectionString });
			await dropper.connect();
			try {
				await dropper.query(`drop schema ${schema} cascade`);
			} finally {
				await dropper.end();
			}
		}
	};
}
