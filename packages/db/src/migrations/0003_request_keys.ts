import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { DatabaseDialect } from '@inventory/shared';

/**
 * Idempotency keys for stock changes queued by the PWA while offline (plan §6.4, M8). A replayed
 * request with a known key returns the stored result instead of changing stock twice.
 */
export function requestKeysSchema(dialect: DatabaseDialect): Migration {
	const timestamp = dialect === 'postgres' ? 'timestamptz' : 'text';
	return {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async up(db: Kysely<any>) {
			await db.schema
				.createTable('request_keys')
				.addColumn('key', 'text', (c) => c.primaryKey())
				.addColumn('response', 'text', (c) => c.notNull())
				.addColumn('created_at', timestamp, (c) => c.notNull())
				.execute();
			await db.schema
				.createIndex('request_keys_created_idx')
				.on('request_keys')
				.column('created_at')
				.execute();
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async down(db: Kysely<any>) {
			await db.schema.dropTable('request_keys').ifExists().execute();
		}
	};
}
