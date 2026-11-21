import { z } from 'zod';
import type { AttributeValue, Attributes, FieldDef } from './fields.ts';

/**
 * Runtime validation of `items.attributes` from a category's (resolved) field definitions
 * (plan §3.2). Used authoritatively by the API on write and by the PWA for forms.
 *
 * - Required fields must be present and non-null.
 * - Optional fields may be omitted or null; empty strings become null.
 * - `quantity` values are plain numbers in the field's unit (the UI parses "4.7k" via parseSi).
 */
export function fieldValueSchema(def: FieldDef): z.ZodType<AttributeValue> {
	let schema: z.ZodType<AttributeValue>;
	switch (def.type) {
		case 'text': {
			let s = z.string().trim();
			if (def.maxLength !== undefined) s = s.max(def.maxLength);
			if (def.pattern !== undefined) s = s.regex(new RegExp(def.pattern, 'u'));
			schema = s;
			break;
		}
		case 'number': {
			let n = z.number();
			if (def.integer) n = n.int();
			if (def.min !== undefined) n = n.min(def.min);
			if (def.max !== undefined) n = n.max(def.max);
			schema = n;
			break;
		}
		case 'quantity':
			schema = z.number();
			break;
		case 'boolean':
			schema = z.boolean();
			break;
		case 'enum':
			schema = z.enum(def.options as [string, ...string[]]);
			break;
		case 'multi_enum':
			schema = z
				.array(z.enum(def.options as [string, ...string[]]))
				.refine((v) => new Set(v).size === v.length, 'Values must be unique')
				.refine((v) => !def.required || v.length > 0, 'Select at least one value');
			break;
		case 'date':
			schema = z.iso.date();
			break;
		case 'url':
			schema = z.url({ protocol: /^https?$/, hostname: z.regexes.domain });
			break;
	}

	if (def.required) return schema;
	const emptyToNull =
		def.type === 'text' || def.type === 'url' || def.type === 'date'
			? z.preprocess(
					(v) => (typeof v === 'string' && v.trim() === '' ? null : v),
					schema.nullable()
				)
			: schema.nullable();
	return emptyToNull.optional() as z.ZodType<AttributeValue>;
}

export interface AttributesSchemaOptions {
	/**
	 * Keys not declared by any field that are still accepted (passed through unchanged).
	 * Use the item's existing attribute keys on update, so values of removed fields survive
	 * (plan §3.2 "removing a field hides it; data stays in JSON").
	 */
	allowUnknownKeys?: Iterable<string>;
}

export function buildAttributesSchema(
	defs: readonly FieldDef[],
	options: AttributesSchemaOptions = {}
): z.ZodType<Attributes> {
	const shape = Object.fromEntries(defs.map((d) => [d.key, fieldValueSchema(d)]));
	const allowed = new Set(options.allowUnknownKeys ?? []);
	return z
		.looseObject(shape)
		.superRefine((value, ctx) => {
			for (const key of Object.keys(value)) {
				if (!(key in shape) && !allowed.has(key)) {
					ctx.addIssue({ code: 'custom', path: [key], message: `Unknown field "${key}"` });
				}
			}
		})
		.transform((value) => {
			// Drop optional fields that were omitted (undefined) so they are not stored.
			const out: Attributes = {};
			for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = v as AttributeValue;
			return out;
		}) as unknown as z.ZodType<Attributes>;
}

/** Validate one existing value against a (possibly changed) definition. */
export function isValidFieldValue(def: FieldDef, value: unknown): boolean {
	return fieldValueSchema(def).safeParse(value).success;
}
