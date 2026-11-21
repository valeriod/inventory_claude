import { z } from 'zod';
import type { ItemWithAvailability, Location, Project } from '../domain.ts';
import { locationCodeSchema, skuSchema } from '../sku.ts';

const id = z.number().int().positive();
/** Quantities are integers in base units (plan §3.4). */
const qty = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const note = z.string().trim().max(1000).nullable().optional();

const itemFields = {
	categoryId: id,
	name: z.string().trim().min(1).max(200),
	description: z.string().trim().max(5000).nullable(),
	qtyMin: qty.nullable(),
	locationId: id.nullable(),
	barcode: z.string().trim().max(128).nullable(),
	attributes: z.record(z.string(), z.unknown())
};

export const createItemRequestSchema = z.strictObject({
	/** Omit to generate from the category's SKU prefix. */
	sku: skuSchema.optional(),
	categoryId: itemFields.categoryId,
	name: itemFields.name,
	description: itemFields.description.optional(),
	/** Initial stock (base units), recorded as a `receive` movement. */
	qtyOnHand: qty.optional(),
	qtyMin: itemFields.qtyMin.optional(),
	locationId: itemFields.locationId.optional(),
	barcode: itemFields.barcode.optional(),
	attributes: itemFields.attributes.optional()
});
export type CreateItemRequest = z.input<typeof createItemRequestSchema>;

/**
 * Partial update. `attributes` is merged into the stored attributes (send `null` to clear a
 * value). SKU and quantity are not editable here; stock changes go through movements.
 */
export const updateItemRequestSchema = z
	.strictObject(itemFields)
	.partial()
	.refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export type UpdateItemRequest = z.input<typeof updateItemRequestSchema>;

/** Manual stock changes. Counts use /count; project consumption goes through reservations. */
export const stockMovementRequestSchema = z.strictObject({
	delta: z
		.number()
		.int()
		.refine((d) => d !== 0, 'delta must not be zero')
		.refine((d) => Math.abs(d) <= Number.MAX_SAFE_INTEGER, 'delta is too large'),
	reason: z.enum(['receive', 'consume', 'adjust']),
	note,
	projectId: id.nullable().optional()
});
export type StockMovementRequest = z.input<typeof stockMovementRequestSchema>;

export const stockCountRequestSchema = z.strictObject({ countedQty: qty, note });
export type StockCountRequest = z.input<typeof stockCountRequestSchema>;

const boolParam = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/** Fixed query parameters of GET /api/items (attribute filters use `attr.<key>[op]=value`). */
export const listItemsQuerySchema = z.object({
	q: z.string().trim().max(200).optional(),
	category: z.coerce.number().int().positive().optional(),
	/** Include items in sub-categories of `category` (default true). */
	subcategories: boolParam.default(true),
	location: z.coerce.number().int().positive().optional(),
	/** Include items in sub-locations of `location` (default true). */
	sublocations: boolParam.default(true),
	lowStock: boolParam.default(false),
	includeArchived: boolParam.default(false),
	sort: z.enum(['name', 'sku', 'qty', 'updated']).default('name'),
	dir: z.enum(['asc', 'desc']).default('asc'),
	page: z.coerce.number().int().positive().default(1),
	pageSize: z.coerce.number().int().min(1).max(200).default(50)
});
export type ListItemsQuery = z.input<typeof listItemsQuerySchema>;

export interface ItemListResponse {
	items: ItemWithAvailability[];
	total: number;
	page: number;
	pageSize: number;
}

export const createLocationRequestSchema = z.strictObject({
	name: z.string().trim().min(1).max(100),
	code: locationCodeSchema,
	parentId: id.nullable().optional(),
	description: z.string().trim().max(1000).nullable().optional()
});
export type CreateLocationRequest = z.input<typeof createLocationRequestSchema>;

export const updateLocationRequestSchema = createLocationRequestSchema
	.partial()
	.refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export type UpdateLocationRequest = z.input<typeof updateLocationRequestSchema>;

/** Result of resolving a scanned barcode / QR code (GET /api/lookup). */
export type LookupResult =
	| { type: 'item'; item: ItemWithAvailability }
	| { type: 'location'; location: Location }
	| { type: 'project'; project: Project };
