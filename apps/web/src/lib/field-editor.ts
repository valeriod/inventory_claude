import {
	FIELD_KEY_PATTERN,
	fieldDefsSchema,
	type FieldDef,
	type FieldDefInput,
	type FieldType
} from '@inventory/shared';

/** Editable representation of a field definition; numeric/list options are kept as strings. */
export interface FieldRow {
	uid: number;
	/** Key as stored on the server; set for saved fields (their key changes via rename only). */
	savedKey: string | null;
	keyEdited: boolean;
	key: string;
	label: string;
	type: FieldType;
	required: boolean;
	searchable: boolean;
	filterable: boolean;
	showInList: boolean;
	help: string;
	maxLength: string;
	pattern: string;
	min: string;
	max: string;
	integer: boolean;
	unit: string;
	allowedPrefixes: string;
	/** One option per line. */
	options: string;
}

export const FIELD_TYPES: { value: FieldType; label: string }[] = [
	{ value: 'text', label: 'Text' },
	{ value: 'number', label: 'Number' },
	{ value: 'quantity', label: 'Value with unit (SI prefixes)' },
	{ value: 'boolean', label: 'Yes / no' },
	{ value: 'enum', label: 'Choice (one)' },
	{ value: 'multi_enum', label: 'Choice (several)' },
	{ value: 'date', label: 'Date' },
	{ value: 'url', label: 'Link' }
];

let nextUid = 1;

export function slugifyKey(label: string): string {
	let key = label
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
	if (/^[0-9]/.test(key)) key = `f_${key}`;
	return key.slice(0, 63);
}

export function newRow(): FieldRow {
	return {
		uid: nextUid++,
		savedKey: null,
		keyEdited: false,
		key: '',
		label: '',
		type: 'text',
		required: false,
		searchable: true,
		filterable: false,
		showInList: false,
		help: '',
		maxLength: '',
		pattern: '',
		min: '',
		max: '',
		integer: false,
		unit: '',
		allowedPrefixes: '',
		options: ''
	};
}

export function toRows(defs: readonly FieldDef[]): FieldRow[] {
	return [...defs]
		.sort((a, b) => a.order - b.order)
		.map((d) => {
			const row: FieldRow = {
				...newRow(),
				savedKey: d.key,
				keyEdited: true,
				key: d.key,
				label: d.label,
				type: d.type,
				required: d.required,
				searchable: d.searchable,
				filterable: d.filterable,
				showInList: d.showInList,
				help: d.help ?? ''
			};
			if (d.type === 'text') {
				row.maxLength = d.maxLength?.toString() ?? '';
				row.pattern = d.pattern ?? '';
			}
			if (d.type === 'number') {
				row.min = d.min?.toString() ?? '';
				row.max = d.max?.toString() ?? '';
				row.integer = d.integer ?? false;
			}
			if (d.type === 'quantity') {
				row.unit = d.unit;
				row.allowedPrefixes = d.allowedPrefixes?.join(', ') ?? '';
			}
			if (d.type === 'enum' || d.type === 'multi_enum') row.options = d.options.join('\n');
			return row;
		});
}

export interface RowsResult {
	defs: FieldDefInput[];
	/** Errors by row uid, then by property. */
	errors: Record<number, Record<string, string>>;
}

function num(value: string): number | undefined | null {
	const t = value.trim();
	if (t === '') return undefined;
	const n = Number(t.replace(',', '.'));
	return Number.isFinite(n) ? n : null;
}

/** Convert editor rows into field definitions (order follows row order), with per-row errors. */
export function fromRows(rows: readonly FieldRow[]): RowsResult {
	const errors: RowsResult['errors'] = {};
	const fail = (row: FieldRow, prop: string, message: string) => {
		(errors[row.uid] ??= {})[prop] ??= message;
	};
	const seen = new Map<string, number>();

	const defs = rows.map((row, index): FieldDefInput => {
		const key = row.key.trim();
		if (!row.label.trim()) fail(row, 'label', 'Enter a label');
		if (!FIELD_KEY_PATTERN.test(key)) {
			fail(row, 'key', 'Lower-case letters, digits and _, starting with a letter');
		} else if (seen.has(key)) {
			fail(row, 'key', 'Another field already uses this key');
		}
		seen.set(key, row.uid);

		const base = {
			key,
			label: row.label.trim(),
			required: row.required,
			searchable: row.searchable,
			filterable: row.filterable,
			showInList: row.showInList,
			order: (index + 1) * 10,
			...(row.help.trim() && { help: row.help.trim() })
		};

		switch (row.type) {
			case 'text': {
				const maxLength = num(row.maxLength);
				if (
					maxLength === null ||
					(maxLength !== undefined && (!Number.isInteger(maxLength) || maxLength < 1))
				) {
					fail(row, 'maxLength', 'Enter a positive whole number');
				}
				return {
					...base,
					type: 'text',
					...(maxLength && { maxLength }),
					...(row.pattern.trim() && { pattern: row.pattern.trim() })
				};
			}
			case 'number': {
				const min = num(row.min);
				const max = num(row.max);
				if (min === null) fail(row, 'min', 'Enter a number');
				if (max === null) fail(row, 'max', 'Enter a number');
				return {
					...base,
					type: 'number',
					...(min != null && { min }),
					...(max != null && { max }),
					...(row.integer && { integer: true })
				};
			}
			case 'quantity': {
				if (!row.unit.trim()) fail(row, 'unit', 'Enter a unit, e.g. Ω or F');
				const prefixes = row.allowedPrefixes
					.split(/[,\s]+/)
					.map((p) => p.trim())
					.filter(Boolean);
				return {
					...base,
					type: 'quantity',
					unit: row.unit.trim(),
					...(prefixes.length && { allowedPrefixes: prefixes })
				};
			}
			case 'enum':
			case 'multi_enum': {
				const options = [
					...new Set(
						row.options
							.split('\n')
							.map((o) => o.trim())
							.filter(Boolean)
					)
				];
				if (options.length === 0) fail(row, 'options', 'Enter at least one option');
				return { ...base, type: row.type, options };
			}
			default:
				return { ...base, type: row.type };
		}
	});

	if (Object.keys(errors).length === 0) {
		const parsed = fieldDefsSchema.safeParse(defs);
		if (!parsed.success) {
			for (const issue of parsed.error.issues) {
				const [index, prop] = issue.path;
				const row = typeof index === 'number' ? rows[index] : undefined;
				if (row) fail(row, String(prop ?? 'label'), issue.message);
			}
		}
	}
	return { defs, errors };
}
