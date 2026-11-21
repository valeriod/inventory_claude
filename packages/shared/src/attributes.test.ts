import { describe, expect, it } from 'vitest';
import { attributeIssues, buildAttributesSchema, isValidFieldValue } from './attributes.ts';
import { fieldDefsSchema, type FieldDefInput } from './fields.ts';

const defs = fieldDefsSchema.parse([
	{ key: 'resistance', label: 'Resistance', type: 'quantity', unit: 'Ω', required: true },
	{ key: 'tolerance', label: 'Tolerance', type: 'enum', options: ['1%', '5%'] },
	{ key: 'power_w', label: 'Power', type: 'number', min: 0, max: 100 },
	{ key: 'pins', label: 'Pins', type: 'number', integer: true },
	{ key: 'mpn', label: 'MPN', type: 'text', maxLength: 10, pattern: '^[A-Z0-9-]+$' },
	{ key: 'rohs', label: 'RoHS', type: 'boolean' },
	{ key: 'tags', label: 'Tags', type: 'multi_enum', options: ['smd', 'precision'] },
	{ key: 'bought', label: 'Bought', type: 'date' },
	{ key: 'datasheet', label: 'Datasheet', type: 'url' }
] satisfies FieldDefInput[]);

const schema = buildAttributesSchema(defs);

describe('buildAttributesSchema', () => {
	it('accepts valid attributes and drops omitted optional fields', () => {
		const input = {
			resistance: 4700,
			tolerance: '1%',
			power_w: 0.25,
			pins: 2,
			mpn: 'RC0603-47K',
			rohs: true,
			tags: ['smd'],
			bought: '2026-11-21',
			datasheet: 'https://example.com/ds.pdf'
		};
		expect(schema.parse(input)).toEqual(input);
		expect(schema.parse({ resistance: 1 })).toEqual({ resistance: 1 });
	});

	it('turns empty strings into null for optional text-like fields', () => {
		expect(schema.parse({ resistance: 1, mpn: ' ', datasheet: '', bought: '' })).toEqual({
			resistance: 1,
			mpn: null,
			datasheet: null,
			bought: null
		});
	});

	it('allows null to clear optional fields', () => {
		expect(schema.parse({ resistance: 1, tolerance: null, tags: null })).toEqual({
			resistance: 1,
			tolerance: null,
			tags: null
		});
	});

	it.each([
		[{}, 'resistance'],
		[{ resistance: null }, 'resistance'],
		[{ resistance: '4.7k' }, 'resistance'],
		[{ resistance: 1, tolerance: '10%' }, 'tolerance'],
		[{ resistance: 1, power_w: -1 }, 'power_w'],
		[{ resistance: 1, power_w: 101 }, 'power_w'],
		[{ resistance: 1, pins: 2.5 }, 'pins'],
		[{ resistance: 1, mpn: 'way-too-long-value' }, 'mpn'],
		[{ resistance: 1, mpn: 'lower' }, 'mpn'],
		[{ resistance: 1, rohs: 'yes' }, 'rohs'],
		[{ resistance: 1, tags: ['smd', 'smd'] }, 'tags'],
		[{ resistance: 1, tags: ['other'] }, 'tags'],
		[{ resistance: 1, bought: '2026-02-30' }, 'bought'],
		[{ resistance: 1, datasheet: 'javascript:alert(1)' }, 'datasheet'],
		[{ resistance: 1, datasheet: 'ftp://example.com/x' }, 'datasheet'],
		[{ resistance: 1, unknown: 'x' }, 'unknown']
	])('rejects %j (path %s)', (input, path) => {
		const result = schema.safeParse(input);
		expect(result.success).toBe(false);
		expect(attributeIssues(result.error!).map((i) => i.key)).toContain(path);
	});

	it('reports every unknown key together with field errors', () => {
		const result = schema.safeParse({ resistance: 'x', a: 1, b: 2 });
		expect(attributeIssues(result.error!).map((i) => i.key)).toEqual(['resistance', 'a', 'b']);
	});

	it('keeps values of removed fields when allowed', () => {
		const lenient = buildAttributesSchema(defs, { allowUnknownKeys: ['legacy'] });
		expect(lenient.parse({ resistance: 1, legacy: 'kept' })).toEqual({
			resistance: 1,
			legacy: 'kept'
		});
		expect(lenient.safeParse({ resistance: 1, other: 'x' }).success).toBe(false);
	});

	it('requires at least one value for required multi-enums', () => {
		const [tags] = fieldDefsSchema.parse([
			{ key: 'tags', label: 'Tags', type: 'multi_enum', options: ['a'], required: true }
		]);
		expect(isValidFieldValue(tags!, [])).toBe(false);
		expect(isValidFieldValue(tags!, ['a'])).toBe(true);
	});
});

describe('field definition checks', () => {
	it('rejects invalid regex patterns and inverted ranges', () => {
		expect(() =>
			fieldDefsSchema.parse([{ key: 'a', label: 'A', type: 'text', pattern: '(' }])
		).toThrow(/regular expression/);
		expect(() =>
			fieldDefsSchema.parse([{ key: 'a', label: 'A', type: 'number', min: 5, max: 1 }])
		).toThrow(/min must not exceed max/);
	});
});
