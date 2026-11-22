import { InvalidOperationError, type Repositories } from '@inventory/db';
import {
	attributeIssues,
	buildAttributesSchema,
	formatAttributeText,
	fromBase,
	MAX_IMPORT_ROWS,
	parseAttributeText,
	parseCsv,
	parseQuantity,
	SKU_PATTERN,
	type Attributes,
	type CategoryWithFields,
	type ImportResult,
	type ImportRowResult,
	type ItemWithAvailability,
	type Location,
	type ResolvedFieldDef
} from '@inventory/shared';
import { BadRequestError } from '../http/errors.ts';

/**
 * Items CSV (plan §4 import/export). One row per item; the export writes the same columns the
 * import reads, so a file can be exported, edited in a spreadsheet and imported again.
 *
 * Standard columns (case-insensitive): SKU, Name, Description, Category (name or path),
 * Location (code), Barcode, On hand, Unit, Min. Every other column is a custom field, matched
 * by key or label within the row's category.
 */
const STANDARD: Record<string, string[]> = {
	sku: ['sku'],
	name: ['name'],
	description: ['description'],
	category: ['category'],
	location: ['location', 'bin', 'location code'],
	barcode: ['barcode', 'ean', 'upc'],
	qty: ['on hand', 'qty', 'quantity', 'stock'],
	unit: ['unit'],
	min: ['min', 'minimum', 'qty min', 'reorder level']
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function categoryPath(categories: CategoryWithFields[], c: CategoryWithFields): string {
	const names = [c.name];
	let parent = categories.find((p) => p.id === c.parentId);
	while (parent && names.length < 20) {
		names.unshift(parent.name);
		parent = categories.find((p) => p.id === parent!.parentId);
	}
	return names.join(' › ');
}

// ---------------------------------------------------------------------------------------------
// Export

function csvCell(value: string): string {
	const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function exportItemsCsv(repos: Repositories): Promise<string> {
	const [categories, locations] = await Promise.all([
		repos.categories.listWithFields(),
		repos.locations.list()
	]);
	const items: ItemWithAvailability[] = [];
	for (;;) {
		const page = await repos.items.list({ limit: 500, offset: items.length, sort: 'sku' });
		items.push(...page.items);
		if (page.items.length === 0 || items.length >= page.total) break;
	}

	// One column per custom field key; headed by its label unless two keys share a label.
	const fields = new Map<string, ResolvedFieldDef>();
	for (const c of categories)
		for (const d of c.resolvedFieldDefs) if (!fields.has(d.key)) fields.set(d.key, d);
	const labelCount = new Map<string, number>();
	for (const d of fields.values())
		labelCount.set(norm(d.label), (labelCount.get(norm(d.label)) ?? 0) + 1);
	const fieldColumns = [...fields.values()].map((d) => ({
		key: d.key,
		header: labelCount.get(norm(d.label))! > 1 || STANDARD[norm(d.label)] ? d.key : d.label
	}));

	const header = [
		'SKU',
		'Name',
		'Description',
		'Category',
		'Location',
		'Barcode',
		'On hand',
		'Unit',
		'Min'
	];
	const lines = [[...header, ...fieldColumns.map((f) => f.header)].map(csvCell).join(',')];
	const categoryById = new Map(categories.map((c) => [c.id, c]));
	const locationById = new Map(locations.map((l) => [l.id, l]));
	for (const item of items) {
		const cat = categoryById.get(item.categoryId)!;
		const defs = new Map(cat.resolvedFieldDefs.map((d) => [d.key, d]));
		const qty = (base: number | null) =>
			base === null ? '' : String(Number(fromBase(cat.unitKind, base, cat.displayUnit).toFixed(6)));
		const cells = [
			item.sku,
			item.name,
			item.description ?? '',
			categoryPath(categories, cat),
			item.locationId ? (locationById.get(item.locationId)?.code ?? '') : '',
			item.barcode ?? '',
			qty(item.qtyOnHand),
			cat.displayUnit,
			qty(item.qtyMin),
			...fieldColumns.map((f) => formatAttributeText(defs.get(f.key), item.attributes[f.key]))
		];
		lines.push(cells.map(csvCell).join(','));
	}
	return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** Header-only file for one category: what the import expects. */
export async function importTemplateCsv(repos: Repositories, categoryId: number): Promise<string> {
	const category = await repos.categories.getWithFields(categoryId);
	const header = ['SKU', 'Name', 'Description', 'Location', 'Barcode', 'On hand', 'Unit', 'Min'];
	const fields = category.resolvedFieldDefs.map((d) => (STANDARD[norm(d.label)] ? d.key : d.label));
	return `\uFEFF${[...header, ...fields].map(csvCell).join(',')}\r\n`;
}

// ---------------------------------------------------------------------------------------------
// Import

type Planned =
	| { kind: 'create'; input: Parameters<Repositories['items']['create']>[0]; row: ImportRowResult }
	| {
			kind: 'update';
			sku: string;
			patch: Parameters<Repositories['items']['update']>[1];
			countTo: number | null;
			row: ImportRowResult;
	  };

export interface ImportOptions {
	/** Category for rows without a Category column value. */
	defaultCategoryId?: number | undefined;
	/** Set existing items' stock to the file's On hand values (records count movements). */
	updateStock: boolean;
	/** Write the changes if every row is valid; otherwise only check (dry run). */
	commit: boolean;
}

export async function importItemsCsv(
	repos: Repositories,
	text: string,
	options: ImportOptions
): Promise<ImportResult> {
	const table = parseCsv(text);
	if (table.length < 2) throw new BadRequestError('The file has no data rows');
	if (table.length - 1 > MAX_IMPORT_ROWS) {
		throw new BadRequestError(`At most ${MAX_IMPORT_ROWS} rows per import`);
	}
	const [header, ...data] = table as [string[], ...string[][]];

	const [categories, locations] = await Promise.all([
		repos.categories.listWithFields(),
		repos.locations.list()
	]);
	const defaultCategory =
		options.defaultCategoryId === undefined
			? undefined
			: categories.find((c) => c.id === options.defaultCategoryId);
	if (options.defaultCategoryId !== undefined && !defaultCategory) {
		throw new InvalidOperationError(`Category ${options.defaultCategoryId} does not exist`);
	}
	const categoryByName = new Map<string, CategoryWithFields>();
	for (const c of categories) {
		categoryByName.set(norm(categoryPath(categories, c)), c);
		categoryByName.set(norm(categoryPath(categories, c).replace(/ › /g, ' > ')), c);
		if (!categoryByName.has(norm(c.name))) categoryByName.set(norm(c.name), c);
	}
	const locationByCode = new Map<string, Location>(locations.map((l) => [l.code.toLowerCase(), l]));

	// Columns
	const standard: Partial<Record<keyof typeof STANDARD, number>> = {};
	const attributeColumns: { index: number; name: string }[] = [];
	header.forEach((h, index) => {
		const name = norm(h);
		const field = Object.entries(STANDARD).find(([, aliases]) => aliases.includes(name))?.[0];
		if (field && standard[field] === undefined) standard[field] = index;
		else if (name) attributeColumns.push({ index, name: name.replace(/^attr[:.]/, '') });
	});
	if (standard.name === undefined && standard.sku === undefined) {
		throw new BadRequestError('The file needs a "Name" or "SKU" column');
	}
	const knownFieldNames = new Set(
		categories.flatMap((c) => c.resolvedFieldDefs.flatMap((d) => [norm(d.key), norm(d.label)]))
	);
	const unknownColumns = attributeColumns
		.filter((c) => !knownFieldNames.has(c.name))
		.map((c) => header[c.index]!.trim());

	const rows: ImportRowResult[] = [];
	const planned: Planned[] = [];
	const skusInFile = new Map<string, number>();
	const barcodesInFile = new Map<string, number>();

	for (const [i, cells] of data.entries()) {
		const line = i + 2;
		const get = (field: keyof typeof STANDARD) =>
			standard[field] === undefined ? undefined : (cells[standard[field]] ?? '').trim();
		const errors: string[] = [];
		const warnings: string[] = [];
		const sku = get('sku') || null;
		const row: ImportRowResult = {
			line,
			sku,
			name: get('name') ?? '',
			action: 'error',
			errors,
			warnings
		};
		rows.push(row);

		if (sku) {
			if (!SKU_PATTERN.test(sku))
				errors.push(`SKU "${sku}" may only contain letters, digits, ".", "_" or "-"`);
			const previous = skusInFile.get(sku.toLowerCase());
			if (previous) errors.push(`SKU ${sku} also appears on line ${previous}`);
			skusInFile.set(sku.toLowerCase(), line);
		}
		const existing = sku && SKU_PATTERN.test(sku) ? await repos.items.find(sku) : undefined;
		if (existing) row.name ||= existing.name;

		// Category
		const categoryText = get('category');
		let category: CategoryWithFields | undefined;
		if (existing) {
			category = categories.find((c) => c.id === existing.categoryId);
			if (categoryText && categoryByName.get(norm(categoryText))?.id !== existing.categoryId) {
				errors.push(
					"Changing an item's category is not supported by import; edit the item instead"
				);
			}
		} else if (categoryText) {
			category = categoryByName.get(norm(categoryText));
			if (!category) errors.push(`Unknown category "${categoryText}"`);
		} else {
			category = defaultCategory;
			if (!category) errors.push('No category: add a Category column or choose a category');
		}
		if (!existing && !row.name) errors.push('Name is required');
		if (!category) continue;

		const unitText = get('unit') || category.displayUnit;
		const quantity = (field: 'qty' | 'min', label: string): number | null | undefined => {
			const t = get(field);
			if (t === undefined || t === '') return t === undefined ? undefined : null;
			try {
				const base = parseQuantity(category!.unitKind, t, unitText);
				if (base < 0) throw new Error('negative');
				return base;
			} catch {
				errors.push(
					`${label}: cannot read "${t}" as ${category!.unitKind === 'count' ? 'a count' : `a quantity in ${unitText}`}`
				);
				return undefined;
			}
		};
		const qty = quantity('qty', 'On hand');
		const qtyMin = quantity('min', 'Min');

		const locationText = get('location');
		let locationId: number | null | undefined;
		if (locationText !== undefined) {
			if (locationText === '') locationId = null;
			else {
				const location = locationByCode.get(locationText.toLowerCase());
				if (location) locationId = location.id;
				else errors.push(`Unknown location code "${locationText}"`);
			}
		}

		const barcodeText = get('barcode');
		const barcode = barcodeText === undefined ? undefined : barcodeText || null;
		if (barcode) {
			const previous = barcodesInFile.get(barcode);
			if (previous) errors.push(`Barcode ${barcode} also appears on line ${previous}`);
			barcodesInFile.set(barcode, line);
			const owner = await repos.items.findByBarcode(barcode);
			if (owner && owner.sku !== existing?.sku)
				errors.push(`Barcode ${barcode} belongs to ${owner.sku}`);
		}

		// Custom fields
		const defs = category.resolvedFieldDefs;
		const attributes: Attributes = {};
		for (const column of attributeColumns) {
			const def = defs.find((d) => norm(d.key) === column.name || norm(d.label) === column.name);
			const raw = cells[column.index] ?? '';
			if (!def) {
				if (raw.trim() && knownFieldNames.has(column.name)) {
					warnings.push(
						`"${header[column.index]!.trim()}" is not a field of ${category.name}; ignored`
					);
				}
				continue;
			}
			const parsed = parseAttributeText(def, raw);
			if ('error' in parsed) errors.push(`${def.label}: ${parsed.error}`);
			else attributes[def.key] = parsed.value;
		}
		const merged: Attributes = existing ? { ...existing.attributes, ...attributes } : attributes;
		const check = buildAttributesSchema(defs, {
			allowUnknownKeys: existing ? Object.keys(existing.attributes) : []
		}).safeParse(merged);
		if (!check.success) {
			for (const issue of attributeIssues(check.error)) {
				const label = defs.find((d) => d.key === issue.key)?.label ?? issue.key;
				errors.push(`${label}: ${issue.message}`);
			}
		}

		if (errors.length > 0) continue;

		if (!existing) {
			row.action = 'create';
			planned.push({
				kind: 'create',
				row,
				input: {
					...(sku && { sku }),
					categoryId: category.id,
					name: row.name,
					description: get('description') || null,
					...(qty && { qtyOnHand: qty }),
					...(qtyMin !== undefined && { qtyMin }),
					...(locationId !== undefined && { locationId }),
					...(barcode !== undefined && { barcode }),
					attributes
				}
			});
			continue;
		}

		const patch: Parameters<Repositories['items']['update']>[1] = {};
		const name = get('name');
		if (name && name !== existing.name) patch.name = name;
		const description = get('description');
		if (description !== undefined && (description || null) !== existing.description) {
			patch.description = description || null;
		}
		if (qtyMin !== undefined && qtyMin !== existing.qtyMin) patch.qtyMin = qtyMin;
		if (locationId !== undefined && locationId !== existing.locationId)
			patch.locationId = locationId;
		if (barcode !== undefined && barcode !== existing.barcode) patch.barcode = barcode;
		if (JSON.stringify(merged) !== JSON.stringify(existing.attributes)) {
			const changed = Object.keys(attributes).some(
				(k) =>
					JSON.stringify(attributes[k] ?? null) !== JSON.stringify(existing.attributes[k] ?? null)
			);
			if (changed) patch.attributes = merged;
		}
		const countTo =
			options.updateStock && qty !== undefined && qty !== null && qty !== existing.qtyOnHand
				? qty
				: null;
		if (qty !== undefined && qty !== null && qty !== existing.qtyOnHand && !options.updateStock) {
			warnings.push('On hand differs from the stock; not changed (stock updates are off)');
		}
		row.action = Object.keys(patch).length > 0 || countTo !== null ? 'update' : 'unchanged';
		if (row.action === 'update')
			planned.push({ kind: 'update', sku: existing.sku, patch, countTo, row });
	}

	const summary = { create: 0, update: 0, unchanged: 0, error: 0 };
	for (const row of rows) summary[row.action]++;

	let committed = false;
	if (options.commit && summary.error === 0) {
		await repos.transaction(async (tx) => {
			for (const op of planned) {
				if (op.kind === 'create') {
					const item = await tx.items.create(op.input);
					op.row.sku = item.sku;
				} else {
					if (Object.keys(op.patch).length > 0) await tx.items.update(op.sku, op.patch);
					if (op.countTo !== null) {
						await tx.stock.count({ sku: op.sku, countedQty: op.countTo, note: 'CSV import' });
					}
				}
			}
		});
		committed = true;
	}
	return { rows, summary, unknownColumns, committed };
}
