import type { Migration } from 'kysely/migration';
import type { DatabaseDialect } from '@inventory/shared';
import { coreSchema } from './0001_core.ts';
import { projectPartsSchema } from './0002_project_parts.ts';
import { requestKeysSchema } from './0003_request_keys.ts';

/**
 * All migrations, keyed by a sortable name. Kept in code rather than loaded from disk so the API
 * can be bundled into a single file. Each migration receives the dialect so it can branch where
 * SQLite and Postgres differ.
 */
export function getMigrations(dialect: DatabaseDialect): Record<string, Migration> {
	return {
		'0001_core': coreSchema(dialect),
		'0002_project_parts': projectPartsSchema(dialect),
		'0003_request_keys': requestKeysSchema(dialect)
	};
}
