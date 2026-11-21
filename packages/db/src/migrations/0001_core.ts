import { sql, type ColumnDefinitionBuilder, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import type { DatabaseDialect } from '@inventory/shared';

/**
 * Core schema (plan §3.1). Written once for both dialects; differences are confined to the
 * column-type helpers at the top and the full-text search section at the bottom.
 */
export function coreSchema(dialect: DatabaseDialect): Migration {
	const pg = dialect === 'postgres';
	const timestamp = pg ? 'timestamptz' : 'text';
	const bigint = pg ? 'bigint' : 'integer';
	const json = pg ? 'jsonb' : 'text';
	const id = (c: ColumnDefinitionBuilder) =>
		pg ? c.primaryKey().generatedByDefaultAsIdentity() : c.primaryKey().autoIncrement();
	const inList = (column: string, values: readonly string[]) =>
		sql`${sql.ref(column)} in (${sql.join(values.map((v) => sql.lit(v)))})`;

	return {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async up(db: Kysely<any>) {
			await db.schema
				.createTable('categories')
				.addColumn('id', 'integer', id)
				.addColumn('name', 'text', (c) => c.notNull().unique())
				.addColumn('parent_id', 'integer', (c) =>
					c.references('categories.id').onDelete('restrict')
				)
				.addColumn('sku_prefix', 'text', (c) => c.unique())
				.addColumn('sku_seq', 'integer', (c) => c.notNull().defaultTo(0))
				.addColumn('unit_kind', 'text', (c) => c.notNull())
				.addColumn('display_unit', 'text', (c) => c.notNull())
				.addColumn('field_defs', json, (c) => c.notNull())
				.addColumn('created_at', timestamp, (c) => c.notNull())
				.addColumn('updated_at', timestamp, (c) => c.notNull())
				.addCheckConstraint(
					'categories_unit_kind_check',
					inList('unit_kind', ['count', 'length', 'mass', 'volume'])
				)
				.$call((b) =>
					pg ? b : b.addCheckConstraint('categories_field_defs_json', sql`json_valid(field_defs)`)
				)
				.execute();
			await db.schema
				.createIndex('categories_parent_idx')
				.on('categories')
				.column('parent_id')
				.execute();

			await db.schema
				.createTable('locations')
				.addColumn('id', 'integer', id)
				.addColumn('name', 'text', (c) => c.notNull())
				.addColumn('parent_id', 'integer', (c) => c.references('locations.id').onDelete('restrict'))
				.addColumn('code', 'text', (c) => c.notNull().unique())
				.addColumn('description', 'text')
				.addColumn('created_at', timestamp, (c) => c.notNull())
				.addColumn('updated_at', timestamp, (c) => c.notNull())
				.execute();
			await db.schema
				.createIndex('locations_parent_idx')
				.on('locations')
				.column('parent_id')
				.execute();

			await db.schema
				.createTable('projects')
				.addColumn('id', 'integer', id)
				.addColumn('name', 'text', (c) => c.notNull())
				.addColumn('description', 'text')
				.addColumn('status', 'text', (c) => c.notNull())
				.addColumn('created_at', timestamp, (c) => c.notNull())
				.addColumn('updated_at', timestamp, (c) => c.notNull())
				.addCheckConstraint(
					'projects_status_check',
					inList('status', ['planning', 'active', 'completed', 'cancelled'])
				)
				.execute();

			await db.schema
				.createTable('items')
				.addColumn('sku', 'text', (c) => c.primaryKey())
				.addColumn('category_id', 'integer', (c) =>
					c.notNull().references('categories.id').onDelete('restrict')
				)
				.addColumn('name', 'text', (c) => c.notNull())
				.addColumn('description', 'text')
				.addColumn('qty_on_hand', bigint, (c) => c.notNull().defaultTo(0))
				.addColumn('qty_min', bigint)
				.addColumn('location_id', 'integer', (c) =>
					c.references('locations.id').onDelete('restrict')
				)
				.addColumn('barcode', 'text', (c) => c.unique())
				.addColumn('attributes', json, (c) => c.notNull())
				.addColumn('search_text', 'text', (c) => c.notNull())
				.addColumn('version', 'integer', (c) => c.notNull().defaultTo(1))
				.addColumn('archived_at', timestamp)
				.addColumn('created_at', timestamp, (c) => c.notNull())
				.addColumn('updated_at', timestamp, (c) => c.notNull())
				.addCheckConstraint('items_qty_on_hand_check', sql`qty_on_hand >= 0`)
				.addCheckConstraint('items_qty_min_check', sql`qty_min is null or qty_min >= 0`)
				.$call((b) =>
					pg ? b : b.addCheckConstraint('items_attributes_json', sql`json_valid(attributes)`)
				)
				.execute();
			await db.schema.createIndex('items_category_idx').on('items').column('category_id').execute();
			await db.schema.createIndex('items_location_idx').on('items').column('location_id').execute();
			await db.schema.createIndex('items_name_idx').on('items').column('name').execute();

			await db.schema
				.createTable('reservations')
				.addColumn('id', 'integer', id)
				.addColumn('project_id', 'integer', (c) =>
					c.notNull().references('projects.id').onDelete('cascade')
				)
				.addColumn('sku', 'text', (c) => c.notNull().references('items.sku').onDelete('restrict'))
				.addColumn('qty_reserved', bigint, (c) => c.notNull())
				.addColumn('status', 'text', (c) => c.notNull())
				.addColumn('note', 'text')
				.addColumn('created_at', timestamp, (c) => c.notNull())
				.addColumn('updated_at', timestamp, (c) => c.notNull())
				.addCheckConstraint('reservations_qty_check', sql`qty_reserved > 0`)
				.addCheckConstraint(
					'reservations_status_check',
					inList('status', ['reserved', 'consumed', 'released'])
				)
				.execute();
			await db.schema
				.createIndex('reservations_sku_status_idx')
				.on('reservations')
				.columns(['sku', 'status'])
				.execute();
			await db.schema
				.createIndex('reservations_project_idx')
				.on('reservations')
				.column('project_id')
				.execute();

			await db.schema
				.createTable('stock_movements')
				.addColumn('id', 'integer', id)
				.addColumn('sku', 'text', (c) => c.notNull().references('items.sku').onDelete('restrict'))
				.addColumn('delta', bigint, (c) => c.notNull())
				.addColumn('reason', 'text', (c) => c.notNull())
				.addColumn('project_id', 'integer', (c) => c.references('projects.id').onDelete('set null'))
				.addColumn('reservation_id', 'integer', (c) =>
					c.references('reservations.id').onDelete('set null')
				)
				.addColumn('note', 'text')
				.addColumn('created_at', timestamp, (c) => c.notNull())
				.addCheckConstraint('stock_movements_delta_check', sql`delta <> 0`)
				.addCheckConstraint(
					'stock_movements_reason_check',
					inList('reason', ['receive', 'consume', 'adjust', 'count', 'reserve_consume'])
				)
				.execute();
			await db.schema
				.createIndex('stock_movements_sku_created_idx')
				.on('stock_movements')
				.columns(['sku', 'created_at'])
				.execute();
			await db.schema
				.createIndex('stock_movements_project_idx')
				.on('stock_movements')
				.column('project_id')
				.execute();
			await db.schema
				.createIndex('stock_movements_created_idx')
				.on('stock_movements')
				.column('created_at')
				.execute();

			// ---- Full-text search & JSON indexing (plan §3.5) ----
			if (pg) {
				await sql`alter table items add column search_vector tsvector
					generated always as (to_tsvector('simple', search_text)) stored`.execute(db);
				await sql`create index items_search_idx on items using gin (search_vector)`.execute(db);
				await sql`create index items_attributes_idx on items using gin (attributes jsonb_path_ops)`.execute(
					db
				);
			} else {
				// A standalone FTS5 table keyed by SKU, kept in sync by triggers. (External-content FTS
				// keyed on rowid is avoided: items has a TEXT primary key, so VACUUM may renumber rowids.)
				await sql`create virtual table items_fts using fts5(
					sku unindexed, search_text, tokenize = 'unicode61 remove_diacritics 2')`.execute(db);
				await sql`create trigger items_fts_insert after insert on items begin
					insert into items_fts (sku, search_text) values (new.sku, new.search_text);
				end`.execute(db);
				await sql`create trigger items_fts_update after update of search_text on items begin
					update items_fts set search_text = new.search_text where sku = old.sku;
				end`.execute(db);
				await sql`create trigger items_fts_delete after delete on items begin
					delete from items_fts where sku = old.sku;
				end`.execute(db);
			}
		},

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async down(db: Kysely<any>) {
			if (!pg) await sql`drop table if exists items_fts`.execute(db);
			for (const table of [
				'stock_movements',
				'reservations',
				'items',
				'projects',
				'locations',
				'categories'
			]) {
				await db.schema.dropTable(table).ifExists().execute();
			}
		}
	};
}
