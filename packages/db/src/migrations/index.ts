import type { Migration } from 'kysely/migration';
import type { DatabaseDialect } from '@inventory/shared';
import { coreSchema } from './0001_core.ts';

/**
 * All migrations, keyed by a sortable name. Kept in code rather than loaded from disk so the API
 * can be bundled into a single file. Each migration receives the dialect so it can branch where
 * SQLite and Postgres differ.
 */
export function getMigrations(dialect: DatabaseDialect): Record<string, Migration> {
	return {
		'0001_core': coreSchema(dialect)
	};
}
