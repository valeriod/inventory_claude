import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { connect, type DatabaseConnection } from './connect.ts';
import { migrateToLatest } from './migrate.ts';
import { parseDatabaseUrl } from './url.ts';

export interface TestDatabase extends DatabaseConnection {
	/** Close the connection and drop the throwaway database (Postgres). */
	cleanup: () => Promise<void>;
}

async function admin(connectionString: string, statement: string): Promise<void> {
	const client = new pg.Client({ connectionString });
	await client.connect();
	try {
		await client.query(statement);
	} finally {
		await client.end();
	}
}

/**
 * A fresh, migrated database for one test.
 * TEST_DATABASE_URL selects the dialect (default: in-memory SQLite). On Postgres, each call
 * creates its own database next to the one in the URL. (Schemas are not isolated enough:
 * Kysely's migrator and introspection look at tables in every schema of the database.)
 */
export async function createTestDatabase(): Promise<TestDatabase> {
	const url = process.env.TEST_DATABASE_URL ?? 'sqlite::memory:';
	const target = parseDatabaseUrl(url);

	if (target.dialect === 'sqlite') {
		const conn = connect(url);
		await migrateToLatest(conn);
		return { ...conn, cleanup: conn.close };
	}

	const name = `test_${randomBytes(6).toString('hex')}`;
	const testUrl = new URL(target.connectionString);
	testUrl.pathname = `/${name}`;

	await admin(target.connectionString, `create database ${name}`);
	const conn = connect(testUrl.toString());
	try {
		await migrateToLatest(conn);
	} catch (err) {
		await conn.close();
		await admin(target.connectionString, `drop database if exists ${name} with (force)`);
		throw err;
	}
	return {
		...conn,
		cleanup: async () => {
			await conn.close();
			await admin(target.connectionString, `drop database if exists ${name} with (force)`);
		}
	};
}
