import { z } from 'zod';
import { unitKindSchema } from '../enums.ts';
import { fieldDefsSchema, fieldKeySchema } from '../fields.ts';
import { skuPrefixSchema } from '../sku.ts';
import { isValidDisplayUnit, unitsFor } from '../units.ts';

const categoryFields = {
	name: z.string().trim().min(1).max(100),
	parentId: z.number().int().positive().nullable(),
	skuPrefix: skuPrefixSchema.nullable(),
	unitKind: unitKindSchema,
	displayUnit: z.string().trim().min(1).max(20),
	fieldDefs: fieldDefsSchema
};

export const createCategoryRequestSchema = z
	.strictObject({
		...categoryFields,
		parentId: categoryFields.parentId.optional(),
		skuPrefix: categoryFields.skuPrefix.optional(),
		fieldDefs: categoryFields.fieldDefs.optional()
	})
	.superRefine((v, ctx) => {
		if (!isValidDisplayUnit(v.unitKind, v.displayUnit)) {
			ctx.addIssue({
				code: 'custom',
				path: ['displayUnit'],
				message: `Use one of: ${unitsFor(v.unitKind).join(', ')}`
			});
		}
	});
export type CreateCategoryRequest = z.input<typeof createCategoryRequestSchema>;

/** Partial update; display unit vs. unit kind is checked against the stored category. */
export const updateCategoryRequestSchema = z
	.strictObject(categoryFields)
	.partial()
	.refine((v) => Object.keys(v).length > 0, 'Provide at least one field to update');
export type UpdateCategoryRequest = z.input<typeof updateCategoryRequestSchema>;

export const renameFieldRequestSchema = z.strictObject({ newKey: fieldKeySchema });
export type RenameFieldRequest = z.input<typeof renameFieldRequestSchema>;
