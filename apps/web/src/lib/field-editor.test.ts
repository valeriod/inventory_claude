import { fieldDefsSchema } from '@inventory/shared';
import { describe, expect, it } from 'vitest';
import { fromRows, newRow, slugifyKey, toRows } from './field-editor.ts';

describe('field editor rows', () => {
	it('slugifies labels into keys', () => {
		expect(slugifyKey('Gauge (AWG)')).toBe('gauge_awg');
		expect(slugifyKey('Résistance')).toBe('resistance');
		expect(slugifyKey('3D model')).toBe('f_3d_model');
	});

	it('round-trips field definitions', () => {
		const defs = fieldDefsSchema.parse([
			{
				key: 'resistance',
				label: 'Resistance',
				type: 'quantity',
				unit: 'Ω',
				allowedPrefixes: ['k', 'M'],
				order: 1
			},
			{
				key: 'tolerance',
				label: 'Tolerance',
				type: 'enum',
				options: ['1%', '5%'],
				filterable: true,
				order: 2
			},
			{ key: 'pins', label: 'Pins', type: 'number', integer: true, min: 1, order: 3 },
			{
				key: 'mpn',
				label: 'MPN',
				type: 'text',
				maxLength: 40,
				help: 'Manufacturer part number',
				order: 4
			}
		]);
		const { defs: out, errors } = fromRows(toRows(defs));
		expect(errors).toEqual({});
		expect(fieldDefsSchema.parse(out)).toEqual(defs.map((d, i) => ({ ...d, order: (i + 1) * 10 })));
	});

	it('reports problems per row and property', () => {
		const a = { ...newRow(), key: 'colour', label: 'Colour', type: 'enum' as const };
		const b = { ...newRow(), key: 'colour', label: '' };
		const c = { ...newRow(), key: 'Bad Key', label: 'x', type: 'quantity' as const };
		const d = { ...newRow(), key: 'n', label: 'N', type: 'number' as const, min: 'abc' };
		const { errors } = fromRows([a, b, c, d]);
		expect(errors[a.uid]).toEqual({ options: 'Enter at least one option' });
		expect(Object.keys(errors[b.uid]!).sort()).toEqual(['key', 'label']);
		expect(Object.keys(errors[c.uid]!).sort()).toEqual(['key', 'unit']);
		expect(errors[d.uid]).toEqual({ min: 'Enter a number' });
	});

	it('surfaces schema-level checks such as invalid patterns', () => {
		const row = { ...newRow(), key: 'mpn', label: 'MPN', pattern: '(' };
		expect(fromRows([row]).errors[row.uid]?.pattern).toMatch(/regular expression/);
	});
});
