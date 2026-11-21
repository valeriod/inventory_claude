import { Migrator, type MigrationResult } from 'kysely/migration';
import type { DatabaseConnection } from './connect.ts';
import { migrations } from './migrations/index.ts';

export async function migrateToLatest(conn: DatabaseConnection): Promise<MigrationResult[]> {
	const migrator = new Migrator({
		db: conn.db,
		provider: { getMigrations: async () => migrations }
	});
	const { error, results } = await migrator.migrateToLatest();
	if (error) throw error;
	return results ?? [];
}
