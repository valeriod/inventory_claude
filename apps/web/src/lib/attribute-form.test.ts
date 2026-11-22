import { fieldDefsSchema, type FieldDefInput } from '@inventory/shared';
import { describe, expect, it } from 'vitest';
import { fromFormValues, toFormValues } from './attribute-form.ts';

const defs = fieldDefsSchema.parse([
	{ key: 'resistance', label: 'R', type: 'quantity', unit: 'Ω', required: true },
	{ key: 'capacitance', label: 'C', type: 'quantity', unit: 'F' },
	{ key: 'power_w', label: 'P', type: 'number' },
	{ key: 'package', label: 'Pkg', type: 'enum', options: ['0603', 'THT'] },
	{ key: 'rohs', label: 'RoHS', type: 'boolean' },
	{ key: 'tags', label: 'Tags', type: 'multi_enum', options: ['smd', 'precision'] },
	{ key: 'note', label: 'Note', type: 'text' }
] satisfies FieldDefInput[]);

describe('attribute form conversion', () => {
	it('renders stored values as editable text', () => {
		expect(
			toFormValues(defs, {
				resistance: 4700,
				capacitance: 1e-7,
				power_w: 0.25,
				package: '0603',
				rohs: false,
				tags: ['smd'],
				note: null
			})
		).toEqual({
			resistance: '4.7k',
			capacitance: '100n',
			power_w: '0.25',
			package: '0603',
			rohs: 'false',
			tags: ['smd'],
			note: ''
		});
	});

	it('parses form text back into typed values', () => {
		const { attributes, errors } = fromFormValues(defs, {
			resistance: '4k7',
			capacitance: '100nF',
			power_w: '0,25',
			package: 'THT',
			rohs: 'true',
			tags: [],
			note: '  hi  '
		});
		expect(errors).toEqual({});
		expect(attributes).toEqual({
			resistance: 4700,
			capacitance: 1e-7,
			power_w: 0.25,
			package: 'THT',
			rohs: true,
			tags: null,
			note: 'hi'
		});
	});

	it('round-trips', () => {
		const stored = {
			resistance: 2.2,
			capacitance: 4.7e-6,
			power_w: 1,
			package: null,
			rohs: null,
			tags: ['precision'],
			note: 'x'
		};
		expect(fromFormValues(defs, toFormValues(defs, stored)).attributes).toEqual(stored);
	});

	it('reports parse, required and schema errors per field', () => {
		expect(fromFormValues(defs, { resistance: '', power_w: 'abc' }).errors).toEqual({
			resistance: 'Required',
			power_w: 'Enter a number'
		});
		expect(fromFormValues(defs, { resistance: '4.7x' }).errors.resistance).toMatch(
			/Unknown prefix/
		);
		expect(fromFormValues(defs, { resistance: '1', package: '0805' }).errors.package).toBeDefined();
	});
});
