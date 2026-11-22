import type { AttributeValue, FieldDef } from './fields.ts';
import { formatSi, parseSi } from './si.ts';

/**
 * CSV parsing (RFC 4180: quoted fields, doubled quotes, newlines inside quotes) with a UTF-8 BOM
 * stripped and the delimiter detected from the header line (`,`, `;` as written by European
 * Excel, or tab).
 */
export function parseCsv(text: string): string[][] {
	const input = text.replace(/^\uFEFF/, '');
	const firstLine = input.slice(0, input.search(/\r?\n|$/));
	const unquoted = firstLine.replace(/"[^"]*"/g, '');
	const count = (c: string) => unquoted.split(c).length - 1;
	const delimiter = [',', ';', '\t'].reduce((best, c) => (count(c) > count(best) ? c : best), ',');

	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < input.length; i++) {
		const c = input[i]!;
		if (quoted) {
			if (c === '"' && input[i + 1] === '"') {
				field += '"';
				i++;
			} else if (c === '"') quoted = false;
			else field += c;
		} else if (c === '"' && field === '') quoted = true;
		else if (c === delimiter) {
			row.push(field);
			field = '';
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && input[i + 1] === '\n') i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else field += c;
	}
	if (field !== '' || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	// Drop blank lines (a row with one empty field).
	return rows.filter((r) => r.length > 1 || r[0]!.trim() !== '');
}

const TRUE = new Set(['yes', 'y', 'true', '1', 'x', 'ja', 'si', 'oui']);
const FALSE = new Set(['no', 'n', 'false', '0', 'nein', 'non']);

/** Read a custom-field value from text (CSV import). Empty text is null. */
export function parseAttributeText(
	def: FieldDef,
	text: string
): { value: AttributeValue } | { error: string } {
	const t = text.trim();
	if (t === '') return { value: null };
	switch (def.type) {
		case 'number': {
			const n = Number(t.replace(',', '.'));
			return Number.isFinite(n) ? { value: n } : { error: `"${t}" is not a number` };
		}
		case 'quantity':
			try {
				return { value: parseSi(t, def.unit, def.allowedPrefixes) };
			} catch (err) {
				return { error: err instanceof Error ? err.message : `Cannot read "${t}"` };
			}
		case 'boolean': {
			const lower = t.toLowerCase();
			if (TRUE.has(lower)) return { value: true };
			if (FALSE.has(lower)) return { value: false };
			return { error: `"${t}" is not yes or no` };
		}
		case 'enum': {
			const option = def.options.find((o) => o.toLowerCase() === t.toLowerCase());
			return option !== undefined
				? { value: option }
				: { error: `"${t}" is not one of: ${def.options.join(', ')}` };
		}
		case 'multi_enum': {
			const values: string[] = [];
			for (const part of t
				.split(/[;|,]/)
				.map((p) => p.trim())
				.filter(Boolean)) {
				const option = def.options.find((o) => o.toLowerCase() === part.toLowerCase());
				if (option === undefined) {
					return { error: `"${part}" is not one of: ${def.options.join(', ')}` };
				}
				if (!values.includes(option)) values.push(option);
			}
			return { value: values };
		}
		default:
			return { value: t };
	}
}

/** Write a custom-field value as text that parseAttributeText reads back (CSV export). */
export function formatAttributeText(
	def: FieldDef | undefined,
	value: AttributeValue | undefined
): string {
	if (value === null || value === undefined) return '';
	if (Array.isArray(value)) return value.join('; ');
	if (typeof value === 'boolean') return value ? 'yes' : 'no';
	if (def?.type === 'quantity' && typeof value === 'number') {
		return formatSi(value, '', 6).replace(' ', '');
	}
	return String(value);
}
