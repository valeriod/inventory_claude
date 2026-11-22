import type { ColumnType, Generated } from 'kysely';
import type { MovementReason, ProjectStatus, ReservationStatus, UnitKind } from '@inventory/shared';

/**
 * ISO-8601 UTC string. SQLite stores TEXT; Postgres stores timestamptz, which connect.ts
 * parses back to an ISO string, so both dialects return the same shape.
 */
type Timestamp = string;

/**
 * JSON column: written as serialized JSON (use `adapter.json(value)`), read back raw:
 * a string on SQLite and an already-parsed value on Postgres. Use `adapter.parseJson()`.
 */
type Json = ColumnType<unknown, unknown, unknown>;

export interface CategoriesTable {
	id: Generated<number>;
	name: string;
	parent_id: number | null;
	sku_prefix: string | null;
	sku_seq: Generated<number>;
	unit_kind: UnitKind;
	display_unit: string;
	field_defs: Json;
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface LocationsTable {
	id: Generated<number>;
	name: string;
	parent_id: number | null;
	code: string;
	description: string | null;
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface ProjectsTable {
	id: Generated<number>;
	name: string;
	description: string | null;
	status: ProjectStatus;
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface ItemsTable {
	sku: string;
	category_id: number;
	name: string;
	description: string | null;
	qty_on_hand: Generated<number>;
	qty_min: number | null;
	location_id: number | null;
	barcode: string | null;
	attributes: Json;
	/** Normalized, space-separated search tokens (see search.ts). */
	search_text: string;
	version: Generated<number>;
	archived_at: Timestamp | null;
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface ReservationsTable {
	id: Generated<number>;
	project_id: number;
	sku: string;
	qty_reserved: number;
	status: ReservationStatus;
	note: string | null;
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface ProjectPartsTable {
	id: Generated<number>;
	project_id: number;
	sku: string;
	qty_needed: number;
	note: string | null;
	created_at: Timestamp;
	updated_at: Timestamp;
}

export interface StockMovementsTable {
	id: Generated<number>;
	sku: string;
	delta: number;
	reason: MovementReason;
	project_id: number | null;
	reservation_id: number | null;
	note: string | null;
	created_at: Timestamp;
}

export interface RequestKeysTable {
	key: string;
	/** JSON of the original result. */
	response: string;
	created_at: Timestamp;
}

export interface Database {
	categories: CategoriesTable;
	locations: LocationsTable;
	projects: ProjectsTable;
	items: ItemsTable;
	reservations: ReservationsTable;
	project_parts: ProjectPartsTable;
	stock_movements: StockMovementsTable;
	request_keys: RequestKeysTable;
}
