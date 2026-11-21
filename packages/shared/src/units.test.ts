import { describe, expect, it } from 'vitest';
import { formatSi, parseSi } from './si.ts';
import {
	formatQuantity,
	fromBase,
	isValidDisplayUnit,
	parseQuantity,
	resolveUnit,
	toBase,
	UnitError,
	unitsFor
} from './units.ts';

describe('units', () => {
	it('lists units per kind', () => {
		expect(unitsFor('length')).toEqual(['mm', 'cm', 'm', 'in', 'ft']);
		expect(isValidDisplayUnit('length', 'm')).toBe(true);
		expect(isValidDisplayUnit('length', 'kg')).toBe(false);
		expect(isValidDisplayUnit('count', 'pc')).toBe(false); // aliases are not display units
		expect(resolveUnit('count', 'pc')).toBe('pcs');
	});

	it.each([
		['length', 37.5, 'm', 37_500],
		['length', 1, 'ft', 305], // 304.8 mm rounded
		['length', 12, 'in', 305], // 304.8 mm rounded
		['mass', 0.5, 'kg', 500_000],
		['mass', 1, 'oz', 28_350],
		['volume', 2.5, 'mL', 2_500],
		['count', 3, 'pcs', 3],
		['length', -2, 'm', -2_000]
	] as const)('toBase(%s, %d %s) = %d', (kind, value, unit, base) => {
		expect(toBase(kind, value, unit)).toBe(base);
	});

	it('round-trips metric units exactly', () => {
		expect(fromBase('length', toBase('length', 37.5, 'm'), 'm')).toBe(37.5);
	});

	it('rejects units of another kind and non-finite values', () => {
		expect(() => toBase('length', 1, 'kg')).toThrow(UnitError);
		expect(() => toBase('length', Number.NaN, 'm')).toThrow(UnitError);
		expect(() => toBase('length', 1e300, 'm')).toThrow(/too large/);
	});

	it.each([
		['length', 37_500, 'm', '37.5 m'],
		['length', 37_500, 'mm', '37500 mm'],
		['length', 305, 'ft', '1.001 ft'],
		['mass', 1_234_567, 'kg', '1.235 kg'],
		['count', 450, 'pcs', '450 pcs'],
		['length', 1_000, 'm', '1 m']
	] as const)('formatQuantity(%s, %d, %s) = %s', (kind, base, unit, text) => {
		expect(formatQuantity(kind, base, unit)).toBe(text);
	});

	it('formats with a locale', () => {
		expect(formatQuantity('length', 37_500, 'm', 'de')).toBe('37,5 m');
	});

	it.each([
		['37.5 m', 37_500],
		['37,5m', 37_500],
		['450', 450_000], // default unit m
		['12 ft', 3_658],
		['.5 m', 500],
		['250 mm', 250],
		['-1.5', -1_500]
	])('parseQuantity(length, %j) = %d', (input, base) => {
		expect(parseQuantity('length', input, 'm')).toBe(base);
	});

	it.each(['', 'abc', '1.2.3 m', '5 kg', '1 m extra'])('parseQuantity rejects %j', (input) => {
		expect(() => parseQuantity('length', input, 'm')).toThrow(UnitError);
	});
});

describe('SI values', () => {
	it.each([
		['4.7k', 4_700],
		['4k7', 4_700],
		['4.7 kΩ', 4_700],
		['10K', 10_000],
		['2R2', 2.2],
		['220', 220],
		['220Ω', 220],
		['100 ohm', 100],
		['1M', 1_000_000],
		['1e3', 1_000]
	])('parseSi(%j, Ω) = %d', (input, value) => {
		expect(parseSi(input, 'Ω')).toBe(value);
	});

	it.each([
		['100n', 1e-7],
		['100nF', 1e-7],
		['4u7', 4.7e-6],
		['4.7µ', 4.7e-6],
		['4.7μF', 4.7e-6],
		['22p', 2.2e-11],
		['1m', 1e-3]
	])('parseSi(%j, F) = %d', (input, value) => {
		expect(parseSi(input, 'F')).toBe(value);
	});

	it('enforces allowed prefixes', () => {
		expect(parseSi('4.7k', 'Ω', ['k', 'M'])).toBe(4_700);
		expect(() => parseSi('4.7n', 'Ω', ['k', 'M'])).toThrow(/not allowed/);
	});

	it.each(['', 'k', '4.7x', '4..7k', 'abc', '1k2k'])('parseSi rejects %j', (input) => {
		expect(() => parseSi(input, 'Ω')).toThrow();
	});

	it.each([
		[4_700, 'Ω', '4.7 kΩ'],
		[1e-7, 'F', '100 nF'],
		[4.7e-6, 'F', '4.7 µF'],
		[220, 'Ω', '220 Ω'],
		[1_000_000, 'Ω', '1 MΩ'],
		[0, 'Ω', '0 Ω'],
		[0.1, 'W', '100 mW']
	])('formatSi(%d, %s) = %s', (value, unit, text) => {
		expect(formatSi(value, unit)).toBe(text);
	});
});
