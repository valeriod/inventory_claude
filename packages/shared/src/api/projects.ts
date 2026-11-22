import { z } from 'zod';
import { projectStatusSchema } from '../enums.ts';
import { skuSchema } from '../sku.ts';

const projectFields = {
	name: z.string().trim().min(1).max(200),
	description: z.string().trim().max(5000).nullable(),
	status: projectStatusSchema
};

export const createProjectRequestSchema = z.strictObject({
	name: projectFields.name,
	description: projectFields.description.optional(),
	status: projectFields.status.optional()
});
export type CreateProjectRequest = z.input<typeof createProjectRequestSchema>;

export const updateProjectRequestSchema = z
	.strictObject(projectFields)
	.partial()
	.refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type UpdateProjectRequest = z.input<typeof updateProjectRequestSchema>;

/** GET /api/projects?status=planning,active */
export const listProjectsQuerySchema = z.object({
	status: z
		.string()
		.optional()
		.transform((v) => (v ? v.split(',').map((s) => s.trim()) : []))
		.pipe(z.array(projectStatusSchema))
});

/** Quantities are integers in the item's base unit. */
const positiveQty = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const note = z.string().trim().max(1000).nullable().optional();

export const reserveRequestSchema = z.strictObject({
	sku: skuSchema,
	qty: positiveQty,
	note
});
export type ReserveRequest = z.input<typeof reserveRequestSchema>;

/**
 * PATCH /api/reservations/:id — change the quantity, consume (all, or `qty` of it; the rest stays
 * reserved), or release.
 */
export const updateReservationRequestSchema = z.union([
	z.strictObject({ qty: positiveQty, note }),
	z.strictObject({ status: z.literal('consumed'), qty: positiveQty.optional(), note }),
	z.strictObject({ status: z.literal('released') })
]);
export type UpdateReservationRequest = z.input<typeof updateReservationRequestSchema>;

/** PUT /api/projects/:id/parts/:sku — set how much of an item the project needs. */
export const setProjectPartRequestSchema = z.strictObject({
	qtyNeeded: positiveQty,
	note
});
export type SetProjectPartRequest = z.input<typeof setProjectPartRequestSchema>;

/**
 * Pure BOM arithmetic, shared by the API and tests. `available` may be negative (over-committed).
 */
export function bomQuantities(input: {
	needed: number | null;
	used: number;
	reserved: number;
	onHand: number;
	available: number;
}): { remaining: number; canReserve: number; toBuy: number } {
	const remaining =
		input.needed === null ? 0 : Math.max(0, input.needed - input.used - input.reserved);
	const canReserve = Math.min(remaining, Math.max(0, input.available));
	const notOnHand = Math.max(0, input.reserved - input.onHand);
	return { remaining, canReserve, toBuy: remaining - canReserve + notOnHand };
}
