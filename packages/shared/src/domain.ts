import type { Attributes, FieldDef } from './fields.ts';
import type { MovementReason, ProjectStatus, ReservationStatus, UnitKind } from './enums.ts';

/** Timestamps are ISO-8601 UTC strings on both databases. */
export type IsoTimestamp = string;

export interface Category {
	id: number;
	name: string;
	parentId: number | null;
	skuPrefix: string | null;
	unitKind: UnitKind;
	displayUnit: string;
	/** Fields declared on this category only (inheritance is resolved separately). */
	fieldDefs: FieldDef[];
	createdAt: IsoTimestamp;
	updatedAt: IsoTimestamp;
}

export interface Location {
	id: number;
	name: string;
	parentId: number | null;
	code: string;
	description: string | null;
	createdAt: IsoTimestamp;
	updatedAt: IsoTimestamp;
}

export interface Project {
	id: number;
	name: string;
	description: string | null;
	status: ProjectStatus;
	createdAt: IsoTimestamp;
	updatedAt: IsoTimestamp;
}

/** All quantities are integers in the base unit of the category's unit kind (plan §3.4). */
export interface Item {
	sku: string;
	categoryId: number;
	name: string;
	description: string | null;
	qtyOnHand: number;
	qtyMin: number | null;
	locationId: number | null;
	barcode: string | null;
	attributes: Attributes;
	version: number;
	archivedAt: IsoTimestamp | null;
	createdAt: IsoTimestamp;
	updatedAt: IsoTimestamp;
}

export interface ItemWithAvailability extends Item {
	/** Sum of open (status = reserved) reservations. */
	qtyReserved: number;
	/** qtyOnHand − qtyReserved; negative means a shortage. */
	qtyAvailable: number;
}

export interface Reservation {
	id: number;
	projectId: number;
	sku: string;
	qtyReserved: number;
	status: ReservationStatus;
	note: string | null;
	createdAt: IsoTimestamp;
	updatedAt: IsoTimestamp;
}

export interface StockMovement {
	id: number;
	sku: string;
	delta: number;
	reason: MovementReason;
	projectId: number | null;
	reservationId: number | null;
	note: string | null;
	createdAt: IsoTimestamp;
}
