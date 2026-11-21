import { z } from 'zod';

/**
 * Field keys are used in JSON paths and expression-index names, so they are restricted to
 * lower-case identifiers. Never relax this without revisiting packages/db/src/dialect.ts.
 */
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

export const fieldKeySchema = z
	.string()
	.regex(
		FIELD_KEY_PATTERN,
		'Use lower-case letters, digits and underscores, starting with a letter'
	);

const baseField = {
	key: fieldKeySchema,
	label: z.string().trim().min(1).max(100),
	required: z.boolean().default(false),
	searchable: z.boolean().default(true),
	filterable: z.boolean().default(false),
	showInList: z.boolean().default(false),
	order: z.number().int().default(0),
	help: z.string().max(500).optional()
};

const optionsList = z
	.array(z.string().trim().min(1).max(100))
	.min(1)
	.refine((o) => new Set(o).size === o.length, 'Options must be unique');

export const fieldDefSchema = z.discriminatedUnion('type', [
	z.object({
		...baseField,
		type: z.literal('text'),
		maxLength: z.number().int().positive().optional(),
		pattern: z.string().optional()
	}),
	z.object({
		...baseField,
		type: z.literal('number'),
		min: z.number().optional(),
		max: z.number().optional(),
		integer: z.boolean().optional()
	}),
	z.object({
		...baseField,
		type: z.literal('quantity'),
		unit: z.string().trim().min(1).max(20),
		allowedPrefixes: z.array(z.string()).optional()
	}),
	z.object({ ...baseField, type: z.literal('boolean') }),
	z.object({ ...baseField, type: z.literal('enum'), options: optionsList }),
	z.object({ ...baseField, type: z.literal('multi_enum'), options: optionsList }),
	z.object({ ...baseField, type: z.literal('date') }),
	z.object({ ...baseField, type: z.literal('url') })
]);

export type FieldDef = z.infer<typeof fieldDefSchema>;
export type FieldDefInput = z.input<typeof fieldDefSchema>;
export type FieldType = FieldDef['type'];

export const fieldDefsSchema = z
	.array(fieldDefSchema)
	.refine((defs) => new Set(defs.map((d) => d.key)).size === defs.length, {
		message: 'Field keys must be unique within a category'
	});

/** Values stored in `items.attributes`. */
export type AttributeValue = string | number | boolean | string[] | null;
export type Attributes = Record<string, AttributeValue>;
