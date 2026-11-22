import { describe, expect, it } from 'vitest';
import { formatAttributeText, parseAttributeText, parseCsv } from './csv.ts';
import type { AttributeValue, FieldDef } from './fields.ts';

const base = {
	label: 'X',
	required: false,
	searchable: false,
	filterable: false,
	showInList: false,
	order: 0
};

describe('parseCsv', () => {
	it('handles quotes, embedded delimiters, newlines, BOM and CRLF', () => {
		expect(parseCsv('﻿a,b,c\r\n1,"two, 2","say ""hi""\nthere"\r\n\r\n3,,')).toEqual([
			['a', 'b', 'c'],
			['1', 'two, 2', 'say "hi"\nthere'],
			['3', '', '']
		]);
	});

	it('detects semicolon and tab delimiters', () => {
		expect(parseCsv('a;b\n1,5;2')).toEqual([
			['a', 'b'],
			['1,5', '2']
		]);
		expect(parseCsv('a\tb\nx\ty')).toEqual([
			['a', 'b'],
			['x', 'y']
		]);
	});
});

describe('attribute text', () => {
	const quantity: FieldDef = { ...base, key: 'r', type: 'quantity', unit: 'Ω' };
	const yesNo: FieldDef = { ...base, key: 'b', type: 'boolean' };
	const choice: FieldDef = { ...base, key: 'e', type: 'enum', options: ['0603', 'THT'] };
	const tags: FieldDef = { ...base, key: 't', type: 'multi_enum', options: ['smd', 'tht', 'rohs'] };

	it('parses each field type', () => {
		expect(parseAttributeText(quantity, '4k7')).toEqual({ value: 4700 });
		expect(parseAttributeText(quantity, '10 kΩ')).toEqual({ value: 10000 });
		expect(parseAttributeText(yesNo, 'Yes')).toEqual({ value: true });
		expect(parseAttributeText(choice, 'tht')).toEqual({ value: 'THT' });
		expect(parseAttributeText(tags, 'SMD; rohs|smd')).toEqual({ value: ['smd', 'rohs'] });
		expect(parseAttributeText({ ...base, key: 'n', type: 'number' }, '1,5')).toEqual({
			value: 1.5
		});
		expect(parseAttributeText(choice, '')).toEqual({ value: null });
	});

	it('reports unreadable values', () => {
		expect(parseAttributeText(yesNo, 'maybe')).toHaveProperty('error');
		expect(parseAttributeText(choice, '0805')).toHaveProperty('error');
		expect(parseAttributeText(quantity, 'lots')).toHaveProperty('error');
	});

	it('formats values so they read back unchanged', () => {
		for (const [def, value] of [
			[quantity, 4700],
			[yesNo, false],
			[tags, ['smd', 'rohs']],
			[choice, 'THT']
		] as [FieldDef, AttributeValue][]) {
			expect(parseAttributeText(def, formatAttributeText(def, value))).toEqual({ value });
		}
	});
});
