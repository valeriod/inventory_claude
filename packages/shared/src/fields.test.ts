import { describe, expect, it } from 'vitest';
import { fieldDefSchema, fieldDefsSchema } from './fields.ts';
import { formatSku, skuSchema } from './sku.ts';

describe('fieldDefSchema', () => {
	it('applies defaults', () => {
		expect(fieldDefSchema.parse({ key: 'color', label: 'Color', type: 'text' })).toMatchObject({
			required: false,
			searchable: true,
			filterable: false,
			showInList: false,
			order: 0
		});
	});

	it('requires options for enums', () => {
		expect(() => fieldDefSchema.parse({ key: 'pkg', label: 'Package', type: 'enum' })).toThrow();
		expect(() =>
			fieldDefSchema.parse({ key: 'pkg', label: 'Package', type: 'enum', options: ['a', 'a'] })
		).toThrow(/unique/);
	});

	it.each(['Color', '1abc', 'with-dash', 'a.b', "x'); drop table items;--", ''])(
		'rejects unsafe key %j',
		(key) => {
			expect(() => fieldDefSchema.parse({ key, label: 'X', type: 'text' })).toThrow();
		}
	);

	it('rejects duplicate keys in a category', () => {
		expect(() =>
			fieldDefsSchema.parse([
				{ key: 'a', label: 'A', type: 'text' },
				{ key: 'a', label: 'A2', type: 'number' }
			])
		).toThrow(/unique/);
	});
});

describe('sku', () => {
	it('formats with zero padding', () => {
		expect(formatSku('RES-', 7)).toBe('RES-0007');
		expect(formatSku('W', 12345)).toBe('W12345');
	});

	it.each(['RES-0001', 'abc_1.2', 'X'])('accepts %s', (s) => {
		expect(skuSchema.parse(s)).toBe(s);
	});

	it.each(['-abc', 'a/b', 'a b', 'ä', 'x'.repeat(65)])('rejects %j', (s) => {
		expect(() => skuSchema.parse(s)).toThrow();
	});
});
