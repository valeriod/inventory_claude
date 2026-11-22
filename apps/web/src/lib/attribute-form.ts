import {
	attributeIssues,
	buildAttributesSchema,
	formatSi,
	parseSi,
	type AttributeValue,
	type Attributes,
	type FieldDef
} from '@inventory/shared';

/**
 * Form state for attribute inputs. Text-like fields, numbers, quantities, enums and yes/no
 * selects are strings ('' = empty); multi-selects are string arrays.
 */
export type FormValue = string | string[];
export type FormValues = Record<string, FormValue>;

/** "4.7k" style for editing quantity fields (no space, no unit). */
function quantityText(value: number): string {
	return formatSi(value, '', 6).replace(' ', '');
}

export function toFormValues(defs: readonly FieldDef[], attributes: Attributes): FormValues {
	const out: FormValues = {};
	for (const def of defs) {
		const value = attributes[def.key];
		if (def.type === 'multi_enum') {
			out[def.key] = Array.isArray(value) ? [...value] : [];
		} else if (value === null || value === undefined) {
			out[def.key] = '';
		} else if (def.type === 'quantity' && typeof value === 'number') {
			out[def.key] = quantityText(value);
		} else {
			out[def.key] = String(value);
		}
	}
	return out;
}

export interface AttributeFormResult {
	attributes: Attributes;
	errors: Record<string, string>;
}

/**
 * Convert form state back into attribute values and validate them with the same schema the API
 * uses. `existingKeys` are keys already stored on the item (allowed even without a field).
 */
export function fromFormValues(
	defs: readonly FieldDef[],
	values: FormValues,
	existingKeys: Iterable<string> = []
): AttributeFormResult {
	const attributes: Attributes = {};
	const errors: Record<string, string> = {};

	for (const def of defs) {
		const raw = values[def.key];
		let value: AttributeValue = null;
		if (def.type === 'multi_enum') {
			const list = Array.isArray(raw) ? raw : [];
			value = list.length ? list : null;
		} else {
			const text = typeof raw === 'string' ? raw.trim() : '';
			if (text !== '') {
				switch (def.type) {
					case 'number': {
						const n = Number(text.replace(',', '.'));
						if (Number.isFinite(n)) value = n;
						else errors[def.key] = 'Enter a number';
						break;
					}
					case 'quantity':
						try {
							value = parseSi(text, def.unit, def.allowedPrefixes);
						} catch (err) {
							errors[def.key] = err instanceof Error ? err.message : 'Invalid value';
						}
						break;
					case 'boolean':
						value = text === 'true';
						break;
					default:
						value = text;
				}
			}
		}
		if (def.required && value === null && !errors[def.key]) errors[def.key] = 'Required';
		attributes[def.key] = value;
	}

	if (Object.keys(errors).length === 0) {
		const result = buildAttributesSchema(defs, { allowUnknownKeys: existingKeys }).safeParse(
			attributes
		);
		if (!result.success) {
			for (const issue of attributeIssues(result.error)) errors[issue.key] ??= issue.message;
		}
	}
	return { attributes, errors };
}
