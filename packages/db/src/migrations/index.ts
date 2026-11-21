import type { Migration } from 'kysely/migration';

/**
 * All migrations, keyed by a sortable name (e.g. "0001_core_tables").
 * Kept in code rather than loaded from disk so the API can be bundled into a single file.
 * Each migration must work on both SQLite and Postgres; branch on the dialect when needed.
 */
export const migrations: Record<string, Migration> = {};
