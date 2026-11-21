import { Migrator, NO_MIGRATIONS, type MigrationResult } from 'kysely/migration';
import type { DatabaseConnection } from './connect.ts';
import { getMigrations } from './migrations/index.ts';

function migrator(conn: DatabaseConnection): Migrator {
	const migrations = getMigrations(conn.dialect);
	return new Migrator({ db: conn.db, provider: { getMigrations: async () => migrations } });
}

export async function migrateToLatest(conn: DatabaseConnection): Promise<MigrationResult[]> {
	const { error, results } = await migrator(conn).migrateToLatest();
	if (error) throw error;
	return results ?? [];
}

/** Roll back every migration (tests and tooling only). */
export async function migrateToEmpty(conn: DatabaseConnection): Promise<MigrationResult[]> {
	const { error, results } = await migrator(conn).migrateTo(NO_MIGRATIONS);
	if (error) throw error;
	return results ?? [];
}
