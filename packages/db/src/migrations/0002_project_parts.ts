import { sql, type ColumnDefinitionBuilder, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { DatabaseDialect } from '@inventory/shared';

/**
 * Parts list of a project (bill of materials): how much of each item the project needs, whether
 * or not that much is in stock. Reservations stay the allocation of stock on hand; the difference
 * between need and what is used, reserved or reservable is what has to be bought (plan §M7).
 */
export function projectPartsSchema(dialect: DatabaseDialect): Migration {
	const pg = dialect === 'postgres';
	const timestamp = pg ? 'timestamptz' : 'text';
	const bigint = pg ? 'bigint' : 'integer';
	const id = (c: ColumnDefinitionBuilder) =>
		pg ? c.primaryKey().generatedByDefaultAsIdentity() : c.primaryKey().autoIncrement();

	return {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async up(db: Kysely<any>) {
			await db.schema
				.createTable('project_parts')
				.addColumn('id', 'integer', id)
				.addColumn('project_id', 'integer', (c) =>
					c.notNull().references('projects.id').onDelete('cascade')
				)
				.addColumn('sku', 'text', (c) => c.notNull().references('items.sku').onDelete('restrict'))
				.addColumn('qty_needed', bigint, (c) => c.notNull())
				.addColumn('note', 'text')
				.addColumn('created_at', timestamp, (c) => c.notNull())
				.addColumn('updated_at', timestamp, (c) => c.notNull())
				.addUniqueConstraint('project_parts_project_sku_unique', ['project_id', 'sku'])
				.addCheckConstraint('project_parts_qty_check', sql`qty_needed > 0`)
				.execute();
			await db.schema
				.createIndex('project_parts_sku_idx')
				.on('project_parts')
				.column('sku')
				.execute();
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async down(db: Kysely<any>) {
			await db.schema.dropTable('project_parts').ifExists().execute();
		}
	};
}
