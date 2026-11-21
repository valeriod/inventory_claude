import type { UnitKind } from './enums.ts';

/**
 * Stock quantities are stored as whole numbers of a small base unit per unit kind (plan §3.4).
 * Each display unit maps to a factor: 1 display unit = factor base units.
 */
export const UNITS = {
	count: { base: 'pcs', units: { pcs: 1 } },
	length: { base: 'mm', units: { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 } },
	mass: { base: 'mg', units: { mg: 1, g: 1000, kg: 1_000_000, oz: 28_349.523125, lb: 453_592.37 } },
	volume: { base: 'µL', units: { µL: 1, mL: 1000, L: 1_000_000 } }
} as const satisfies Record<UnitKind, { base: string; units: Record<string, number> }>;

export type DisplayUnit<K extends UnitKind = UnitKind> = keyof (typeof UNITS)[K]['units'] & string;

const UNIT_ALIASES: Record<string, string> = {
	pc: 'pcs',
	piece: 'pcs',
	pieces: 'pcs',
	ea: 'pcs',
	uL: 'µL',
	μL: 'µL', // Greek mu
	ml: 'mL',
	l: 'L',
	'"': 'in',
	"'": 'ft'
};

export class UnitError extends Error {}

export function unitsFor(kind: UnitKind): string[] {
	return Object.keys(UNITS[kind].units);
}

export function baseUnit(kind: UnitKind): string {
	return UNITS[kind].base;
}

/** Resolve a unit name or alias for a kind; undefined if it does not belong to the kind. */
export function resolveUnit(kind: UnitKind, unit: string): string | undefined {
	const units: Record<string, number> = UNITS[kind].units;
	const trimmed = unit.trim();
	if (trimmed in units) return trimmed;
	const alias = UNIT_ALIASES[trimmed];
	return alias !== undefined && alias in units ? alias : undefined;
}

export function isValidDisplayUnit(kind: UnitKind, unit: string): boolean {
	return resolveUnit(kind, unit) === unit;
}

function factor(kind: UnitKind, unit: string): number {
	const resolved = resolveUnit(kind, unit);
	if (resolved === undefined) {
		throw new UnitError(`"${unit}" is not a ${kind} unit (use ${unitsFor(kind).join(', ')})`);
	}
	return (UNITS[kind].units as Record<string, number>)[resolved]!;
}

/** Convert a value in `unit` to integer base units, rounding to the nearest base unit. */
export function toBase(kind: UnitKind, value: number, unit: string): number {
	if (!Number.isFinite(value)) throw new UnitError('Quantity must be a finite number');
	const base = Math.round(value * factor(kind, unit));
	if (!Number.isSafeInteger(base)) throw new UnitError('Quantity is too large');
	return Object.is(base, -0) ? 0 : base;
}

/** Convert integer base units to a (possibly fractional) value in `unit`. */
export function fromBase(kind: UnitKind, base: number, unit: string): number {
	return base / factor(kind, unit);
}

/** Decimal places that are meaningful for a unit, given 1-base-unit resolution. */
function decimalsFor(kind: UnitKind, unit: string): number {
	return Math.min(3, Math.max(0, Math.ceil(Math.log10(factor(kind, unit)))));
}

/** 37500 (mm) → "37.5 m". Uses the given locale for number formatting (default: en). */
export function formatQuantity(
	kind: UnitKind,
	base: number,
	unit: string,
	locale: string | undefined = 'en'
): string {
	const value = fromBase(kind, base, unit);
	const text = new Intl.NumberFormat(locale, {
		maximumFractionDigits: decimalsFor(kind, unit),
		useGrouping: false
	}).format(value);
	return `${text} ${resolveUnit(kind, unit)}`;
}

/**
 * Parse user input such as "37.5 m", "37,5m", "12 ft" or "450" into integer base units.
 * A bare number is interpreted in `defaultUnit`.
 */
export function parseQuantity(kind: UnitKind, input: string, defaultUnit: string): number {
	const match = /^\s*([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))\s*(\S*)\s*$/u.exec(input);
	if (!match) throw new UnitError(`Cannot read "${input}" as a quantity`);
	const value = Number(match[1]!.replace(',', '.'));
	return toBase(kind, value, match[2] || defaultUnit);
}
