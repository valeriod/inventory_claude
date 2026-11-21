/**
 * SI-prefix parsing and formatting for `quantity` attribute fields (plan §3.2), e.g. resistance
 * or capacitance. Values are stored as plain numbers in the field's unit (Ω, F, …).
 */
export const SI_PREFIXES = {
	p: 1e-12,
	n: 1e-9,
	µ: 1e-6,
	m: 1e-3,
	'': 1,
	k: 1e3,
	M: 1e6,
	G: 1e9
} as const;

export type SiPrefix = keyof typeof SI_PREFIXES;

const PREFIX_ALIASES: Record<string, SiPrefix> = { u: 'µ', μ: 'µ', K: 'k', R: '', r: '' };

export class SiParseError extends Error {}

function normalizePrefix(p: string): SiPrefix | undefined {
	if (p in SI_PREFIXES) return p as SiPrefix;
	return PREFIX_ALIASES[p];
}

/** Remove floating-point noise such as 4.7 * 1e3 = 4700.000000000001. */
function clean(n: number): number {
	return Number(n.toPrecision(12));
}

/**
 * Parse "4.7k", "4k7", "4.7 kΩ", "100n", "100nF", "2R2", "0.1u", "1e-6" into a number.
 * `unit` (e.g. "Ω") may be appended to the input. `allowedPrefixes` restricts accepted prefixes.
 */
export function parseSi(input: string, unit = '', allowedPrefixes?: readonly string[]): number {
	let text = input.trim().replace(/\s+/g, '');
	if (unit && text.endsWith(unit)) text = text.slice(0, -unit.length);
	if (unit === 'Ω' && /ohms?$/i.test(text)) text = text.replace(/ohms?$/i, '');
	if (text === '') throw new SiParseError(`Cannot read "${input}" as a value`);

	// Plain number, possibly in exponent notation
	if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text)) return clean(Number(text));

	// 4.7k / 100n / 1M
	let m = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-zA-Zµμ])$/u.exec(text);
	// RKM code: 4k7, 2R2, 4u7 (prefix letter as decimal point)
	m ??= /^(\d+)([a-zA-Zµμ])(\d+)$/u.exec(text);
	if (!m) throw new SiParseError(`Cannot read "${input}" as a value`);

	const prefix = normalizePrefix(m[2]!);
	if (prefix === undefined) throw new SiParseError(`Unknown prefix "${m[2]}" in "${input}"`);
	if (allowedPrefixes && !allowedPrefixes.includes(prefix) && prefix !== '') {
		throw new SiParseError(`Prefix "${prefix}" is not allowed for this field`);
	}
	const mantissa = m[3] !== undefined ? Number(`${m[1]}.${m[3]}`) : Number(m[1]);
	return clean(mantissa * SI_PREFIXES[prefix]);
}

/** 4700 → "4.7 kΩ", 1e-7 → "100 nF", 0 → "0 Ω". */
export function formatSi(value: number, unit = '', significantDigits = 4): string {
	const suffix = unit ? ` ${unit}` : '';
	if (value === 0 || !Number.isFinite(value)) return `${value}${suffix}`;
	const exponent = Math.floor(Math.log10(Math.abs(value)) / 3) * 3;
	const clamped = Math.min(9, Math.max(-12, exponent));
	const prefix =
		(Object.keys(SI_PREFIXES) as SiPrefix[]).find((p) => SI_PREFIXES[p] === 10 ** clamped) ?? '';
	const scaled = Number((value / 10 ** clamped).toPrecision(significantDigits));
	return `${scaled} ${prefix}${unit}`.trimEnd();
}
