import type { ItemFilter, Repositories } from '@inventory/db';
import {
	fromBase,
	MAX_REPORT_ROWS,
	subtreeIds,
	type Category,
	type ItemWithAvailability,
	type Location,
	type MovementReason,
	type Report,
	type ReportCell,
	type ReportColumn
} from '@inventory/shared';

/** Quantity in the category's display unit, rounded to what the base unit can resolve. */
function qty(base: number | null, category: Category | undefined): number | null {
	if (base === null) return null;
	if (!category) return base;
	return Number(fromBase(category.unitKind, base, category.displayUnit).toFixed(6));
}

type TreeNode = { id: number; name: string; parentId: number | null };

/** "Workshop › Shelf A › Bin A1" (stops on cycles or missing parents). */
function path(nodes: readonly TreeNode[], id: number | null): string {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const names: string[] = [];
	const seen = new Set<number>();
	let current = id === null ? undefined : byId.get(id);
	while (current && !seen.has(current.id)) {
		names.unshift(current.name);
		seen.add(current.id);
		current = current.parentId === null ? undefined : byId.get(current.parentId);
	}
	return names.join(' › ');
}

/** The node and all its descendants. */
function subtree(nodes: readonly TreeNode[], id: number): number[] {
	return subtreeIds(
		nodes.map((n) => ({ ...n, fieldDefs: [] })),
		id
	);
}

interface Context {
	categories: Category[];
	locations: Location[];
	categoryById: Map<number, Category>;
	locationById: Map<number, Location>;
}

async function context(repos: Repositories): Promise<Context> {
	const [categories, locations] = await Promise.all([
		repos.categories.list(),
		repos.locations.list()
	]);
	return {
		categories,
		locations,
		categoryById: new Map(categories.map((c) => [c.id, c])),
		locationById: new Map(locations.map((l) => [l.id, l]))
	};
}

/** All items matching a filter, page by page. */
async function allItems(repos: Repositories, filter: ItemFilter): Promise<ItemWithAvailability[]> {
	const out: ItemWithAvailability[] = [];
	for (;;) {
		const page = await repos.items.list({
			...filter,
			limit: 500,
			offset: out.length,
			sort: 'name'
		});
		out.push(...page.items);
		if (page.items.length === 0 || out.length >= page.total) return out;
	}
}

function scopeFilters(
	ctx: Context,
	query: { category?: number | undefined; location?: number | undefined }
): { filter: ItemFilter; descriptions: string[] } {
	const filter: ItemFilter = {};
	const descriptions: string[] = [];
	if (query.category !== undefined) {
		filter.categoryIds = subtree(ctx.categories, query.category);
		descriptions.push(`Category: ${path(ctx.categories, query.category) || query.category}`);
	}
	if (query.location !== undefined) {
		filter.locationIds = subtree(ctx.locations, query.location);
		descriptions.push(`Location: ${path(ctx.locations, query.location) || query.location}`);
	}
	return { filter, descriptions };
}

const UNIT: ReportColumn = { key: 'unit', label: 'Unit', type: 'text', width: 0.6 };

function report(
	kind: Report['kind'],
	title: string,
	columns: ReportColumn[],
	rows: Record<string, ReportCell>[],
	extra: Partial<Pick<Report, 'filters' | 'summary' | 'truncated'>> = {}
): Report {
	return {
		kind,
		title,
		filters: extra.filters ?? [],
		generatedAt: new Date().toISOString(),
		columns,
		rows,
		summary: extra.summary ?? [],
		truncated: extra.truncated ?? false
	};
}

export async function inventoryReport(
	repos: Repositories,
	query: { category?: number | undefined; location?: number | undefined; includeArchived: boolean }
): Promise<Report> {
	const ctx = await context(repos);
	const { filter, descriptions } = scopeFilters(ctx, query);
	if (query.includeArchived) descriptions.push('Including archived items');
	const items = await allItems(repos, { ...filter, includeArchived: query.includeArchived });

	const rows = items.map((item) => {
		const cat = ctx.categoryById.get(item.categoryId);
		return {
			sku: item.sku,
			name: item.archivedAt ? `${item.name} (archived)` : item.name,
			category: path(ctx.categories, item.categoryId),
			location: item.locationId ? (ctx.locationById.get(item.locationId)?.code ?? '') : '',
			onHand: qty(item.qtyOnHand, cat),
			reserved: qty(item.qtyReserved, cat),
			available: qty(item.qtyAvailable, cat),
			min: qty(item.qtyMin, cat),
			unit: cat?.displayUnit ?? ''
		};
	});
	const low = items.filter((i) => i.qtyMin !== null && i.qtyAvailable <= i.qtyMin).length;
	return report(
		'inventory',
		'Inventory',
		[
			{ key: 'sku', label: 'SKU', type: 'text', width: 1 },
			{ key: 'name', label: 'Name', type: 'text', width: 2.6 },
			{ key: 'category', label: 'Category', type: 'text', width: 1.8 },
			{ key: 'location', label: 'Location', type: 'text', width: 0.9 },
			{ key: 'onHand', label: 'On hand', type: 'number', width: 0.8 },
			{ key: 'reserved', label: 'Reserved', type: 'number', width: 0.8 },
			{ key: 'available', label: 'Available', type: 'number', width: 0.8 },
			{ key: 'min', label: 'Min', type: 'number', width: 0.7 },
			UNIT
		],
		rows,
		{
			filters: descriptions,
			summary: [
				{ label: 'Items', value: String(items.length) },
				{ label: 'Low stock', value: String(low) }
			]
		}
	);
}

export async function lowStockReport(
	repos: Repositories,
	query: { category?: number | undefined; location?: number | undefined }
): Promise<Report> {
	const ctx = await context(repos);
	const { filter, descriptions } = scopeFilters(ctx, query);
	const items = await allItems(repos, { ...filter, lowStock: true });
	const rows = items.map((item) => {
		const cat = ctx.categoryById.get(item.categoryId);
		const min = item.qtyMin ?? 0;
		return {
			sku: item.sku,
			name: item.name,
			location: item.locationId ? (ctx.locationById.get(item.locationId)?.code ?? '') : '',
			available: qty(item.qtyAvailable, cat),
			min: qty(min, cat),
			toMin: qty(Math.max(0, min - item.qtyAvailable), cat),
			unit: cat?.displayUnit ?? ''
		};
	});
	return report(
		'low-stock',
		'Low stock',
		[
			{ key: 'sku', label: 'SKU', type: 'text', width: 1 },
			{ key: 'name', label: 'Name', type: 'text', width: 3 },
			{ key: 'location', label: 'Location', type: 'text', width: 1 },
			{ key: 'available', label: 'Available', type: 'number', width: 0.9 },
			{ key: 'min', label: 'Min', type: 'number', width: 0.8 },
			{ key: 'toMin', label: 'Short of min', type: 'number', width: 1 },
			UNIT
		],
		rows,
		{ filters: descriptions, summary: [{ label: 'Items', value: String(items.length) }] }
	);
}

export async function projectReport(repos: Repositories, projectId: number): Promise<Report> {
	const [ctx, project, bom] = await Promise.all([
		context(repos),
		repos.projects.get(projectId),
		repos.projectParts.bom(projectId)
	]);
	const rows = bom.map((line) => {
		const cat = ctx.categoryById.get(line.item.categoryId);
		return {
			sku: line.sku,
			name: line.item.name,
			location: line.item.locationId
				? (ctx.locationById.get(line.item.locationId)?.code ?? '')
				: '',
			needed: qty(line.qtyNeeded, cat),
			used: qty(line.qtyUsed, cat),
			reserved: qty(line.qtyReserved, cat),
			canReserve: qty(line.qtyCanReserve, cat),
			toBuy: qty(line.qtyToBuy, cat),
			unit: cat?.displayUnit ?? ''
		};
	});
	const toBuy = bom.filter((l) => l.qtyToBuy > 0).length;
	return report(
		'project',
		`Project: ${project.name}`,
		[
			{ key: 'sku', label: 'SKU', type: 'text', width: 1 },
			{ key: 'name', label: 'Name', type: 'text', width: 2.6 },
			{ key: 'location', label: 'Location', type: 'text', width: 0.9 },
			{ key: 'needed', label: 'Needed', type: 'number', width: 0.8 },
			{ key: 'used', label: 'Used', type: 'number', width: 0.8 },
			{ key: 'reserved', label: 'Reserved', type: 'number', width: 0.8 },
			{ key: 'canReserve', label: 'Can reserve', type: 'number', width: 0.9 },
			{ key: 'toBuy', label: 'To buy', type: 'number', width: 0.8 },
			UNIT
		],
		rows,
		{
			filters: [`Status: ${project.status}`],
			summary: [
				{ label: 'Lines', value: String(bom.length) },
				{ label: 'To buy', value: String(toBuy) }
			]
		}
	);
}

const REASON_LABELS: Record<MovementReason, string> = {
	receive: 'Received',
	consume: 'Used',
	adjust: 'Adjusted',
	count: 'Counted',
	reserve_consume: 'Used for project'
};

export async function movementsReport(
	repos: Repositories,
	query: {
		from?: string | undefined;
		to?: string | undefined;
		sku?: string | undefined;
		reason?: MovementReason | undefined;
		project?: number | undefined;
	}
): Promise<Report> {
	const ctx = await context(repos);
	const filter = {
		...(query.from && { from: new Date(query.from).toISOString() }),
		...(query.to && { to: new Date(query.to).toISOString() }),
		...(query.sku && { sku: query.sku }),
		...(query.reason && { reasons: [query.reason] }),
		...(query.project && { projectId: query.project })
	};
	const movements = [];
	let truncated = false;
	for (;;) {
		const page = await repos.stock.movements({ ...filter, limit: 1000, offset: movements.length });
		movements.push(...page);
		if (movements.length > MAX_REPORT_ROWS) {
			movements.length = MAX_REPORT_ROWS;
			truncated = true;
			break;
		}
		if (page.length < 1000) break;
	}

	const skus = [...new Set(movements.map((m) => m.sku))];
	const items = new Map<string, { name: string; categoryId: number }>();
	for (let i = 0; i < skus.length; i += 500) {
		for (const item of await repos.items.summaries(skus.slice(i, i + 500))) {
			items.set(item.sku, item);
		}
	}
	const projectIds = [...new Set(movements.map((m) => m.projectId).filter((p) => p !== null))];
	const projects = new Map<number, string>();
	for (const pid of projectIds) {
		const p = await repos.projects.find(pid);
		if (p) projects.set(pid, p.name);
	}

	const rows = movements.map((m) => {
		const item = items.get(m.sku);
		const cat = item ? ctx.categoryById.get(item.categoryId) : undefined;
		return {
			at: m.createdAt,
			sku: m.sku,
			name: item?.name ?? '',
			reason: REASON_LABELS[m.reason],
			change: qty(m.delta, cat),
			unit: cat?.displayUnit ?? '',
			project: m.projectId === null ? '' : (projects.get(m.projectId) ?? ''),
			note: m.note ?? ''
		};
	});

	const descriptions: string[] = [];
	if (query.from) descriptions.push(`From: ${query.from}`);
	if (query.to) descriptions.push(`Before: ${query.to}`);
	if (query.sku) descriptions.push(`SKU: ${query.sku}`);
	if (query.reason) descriptions.push(`Reason: ${REASON_LABELS[query.reason]}`);
	if (query.project) descriptions.push(`Project: ${projects.get(query.project) ?? query.project}`);

	return report(
		'movements',
		'Stock movements',
		[
			{ key: 'at', label: 'Date', type: 'datetime', width: 1.3 },
			{ key: 'sku', label: 'SKU', type: 'text', width: 1 },
			{ key: 'name', label: 'Name', type: 'text', width: 2 },
			{ key: 'reason', label: 'Reason', type: 'text', width: 1.1 },
			{ key: 'change', label: 'Change', type: 'number', width: 0.8 },
			UNIT,
			{ key: 'project', label: 'Project', type: 'text', width: 1.2 },
			{ key: 'note', label: 'Note', type: 'text', width: 1.6 }
		],
		rows,
		{
			filters: descriptions,
			summary: [{ label: 'Movements', value: String(rows.length) }],
			truncated
		}
	);
}
