import { describe, expect, it } from 'vitest';
import { buildSearchText, queryTokens, tokenize } from './search.ts';

describe('tokenize', () => {
	it('lower-cases, strips diacritics and splits on punctuation', () => {
		expect(tokenize('Crème-Brûlée RES-0001 10kΩ')).toEqual([
			'creme',
			'brulee',
			'res',
			'0001',
			'10kω'
		]);
	});

	it('returns nothing for punctuation-only input', () => {
		expect(tokenize(' -*"() ')).toEqual([]);
	});
});

describe('queryTokens', () => {
	it('deduplicates and caps the number of tokens', () => {
		expect(queryTokens('a a b')).toEqual(['a', 'b']);
		expect(queryTokens('1 2 3 4 5 6 7 8 9 10 11 12')).toHaveLength(10);
	});

	it('neutralizes FTS operators', () => {
		expect(queryTokens('foo OR "bar" NEAR(baz) -qux*')).toEqual([
			'foo',
			'or',
			'bar',
			'near',
			'baz',
			'qux'
		]);
	});
});

describe('buildSearchText', () => {
	it('includes identifiers and scalar/array attribute values, skipping booleans', () => {
		const text = buildSearchText({
			sku: 'WIR-0012',
			name: 'Hookup wire',
			description: null,
			barcode: '4006381333931',
			attributes: { color: 'red', gauge_awg: 22, stranded: true, tags: ['pvc', 'red'], none: null }
		});
		expect(text.split(' ')).toEqual([
			'wir',
			'0012',
			'hookup',
			'wire',
			'4006381333931',
			'red',
			'22',
			'pvc'
		]);
	});
});
