import {
	buildSearchText,
	listItemsQuerySchema,
	queryTokens,
	searchableKeys,
	subtreeIds,
	type CategoryWithFields,
	type ItemListResponse,
	type ItemWithAvailability,
	type Location,
	type LookupResult,
	type ProjectSummary
} from '@inventory/shared';
import { ApiError, request } from '../http.ts';
import { available, get, getAll, transaction } from './idb.ts';

/**
 * Offline catalogue (plan §6.4): a copy of items, categories, locations and projects in
 * IndexedDB, refreshed while online. When the server cannot be reached, the API client answers
 * reads from it: the item list (search, category, location, low stock), item pages and lookups.
 */

export interface CatalogueMeta {
	syncedAt: string;
	items: number;
}

/** Item as stored offline, with its search tokens (built like the server's index). */
export type StoredItem = ItemWithAvailability & { searchText: string };

const PAGE_SIZE = 200;

/** Download everything and replace the offline copy in one transaction. */
export async function syncCatalogue(): Promise<CatalogueMeta> {
	const [categories, locations, projects] = await Promise.all([
		request<CategoryWithFields[]>('/categories'),
		request<Location[]>('/locations'),
		request<ProjectSummary[]>('/projects')
	]);
	const items: ItemWithAvailability[] = [];
	for (let page = 1; ; page++) {
		const list = await request<ItemListResponse>(
			`/items?includeArchived=true&sort=sku&pageSize=${PAGE_SIZE}&page=${page}`
		);
		items.push(...list.items);
		if (list.items.length < PAGE_SIZE || items.length >= list.total) break;
	}

	const keysByCategory = new Map(
		categories.map((c) => [c.id, searchableKeys(c.resolvedFieldDefs)])
	);
	const stored: StoredItem[] = items.map((item) => ({
		...item,
		searchText: buildSearchText(item, keysByCategory.get(item.categoryId))
	}));
	const meta: CatalogueMeta = { syncedAt: new Date().toISOString(), items: stored.length };

	await transaction(['kv', 'items'], 'readwrite', (tx) => {
		const kv = tx.objectStore('kv');
		kv.put(categories, 'categories');
		kv.put(locations, 'locations');
		kv.put(projects, 'projects');
		kv.put(meta, 'meta');
		const store = tx.objectStore('items');
		store.clear();
		for (const item of stored) store.put(item);
	});
	return meta;
}

export async function catalogueMeta(): Promise<CatalogueMeta | undefined> {
	return available() ? get<CatalogueMeta>('kv', 'meta') : undefined;
}

/** Thrown when the offline copy cannot answer: callers rethrow the original network error. */
export class NotAvailableOffline extends Error {}

async function need<T>(key: string): Promise<T> {
	if (!available()) throw new NotAvailableOffline();
	const value = await get<T>('kv', key);
	if (value === undefined) throw new NotAvailableOffline();
	return value;
}

export const localCategories = () => need<CategoryWithFields[]>('categories');
export const localLocations = () => need<Location[]>('locations');
export const localProjects = () => need<ProjectSummary[]>('projects');

function strip(item: StoredItem): ItemWithAvailability {
	const { searchText: _searchText, ...rest } = item;
	return rest;
}

export async function localItem(sku: string): Promise<ItemWithAvailability> {
	await need('meta');
	const item = await get<StoredItem>('items', sku);
	if (!item) throw new ApiError(404, 'not_found', `Item "${sku}" not found`);
	return strip(item);
}

async function allItems(): Promise<StoredItem[]> {
	await need('meta');
	return getAll<StoredItem>('items');
}

/** GET /api/items, answered from the offline copy (custom-field filters need the server). */
export async function localItems(params: URLSearchParams): Promise<ItemListResponse> {
	if ([...params.keys()].some((k) => k.startsWith('attr.'))) {
		throw new ApiError(0, 'network', 'Filters on custom fields need a connection to the server.');
	}
	const q = listItemsQuerySchema.parse(Object.fromEntries(params));
	let items = await allItems();

	if (!q.includeArchived) items = items.filter((i) => !i.archivedAt);
	if (q.category !== undefined) {
		const ids = new Set(
			q.subcategories ? subtreeIds(await localCategories(), q.category) : [q.category]
		);
		items = items.filter((i) => ids.has(i.categoryId));
	}
	if (q.location !== undefined) {
		const locations = (await localLocations()).map((l) => ({ ...l, fieldDefs: [] }));
		const ids = new Set(q.sublocations ? subtreeIds(locations, q.location) : [q.location]);
		items = items.filter((i) => i.locationId !== null && ids.has(i.locationId));
	}
	if (q.lowStock) items = items.filter((i) => i.qtyMin !== null && i.qtyAvailable <= i.qtyMin);
	if (q.q) {
		// Same rule as the server: every query token is a prefix of some indexed token.
		const tokens = queryTokens(q.q);
		items = items.filter((i) => {
			const indexed = i.searchText.split(' ');
			return tokens.every((t) => indexed.some((w) => w.startsWith(t)));
		});
	}

	const compare: Record<typeof q.sort, (a: StoredItem, b: StoredItem) => number> = {
		name: (a, b) => a.name.localeCompare(b.name),
		sku: (a, b) => a.sku.localeCompare(b.sku),
		qty: (a, b) => a.qtyOnHand - b.qtyOnHand,
		updated: (a, b) => a.updatedAt.localeCompare(b.updatedAt)
	};
	const sign = q.dir === 'desc' ? -1 : 1;
	items.sort((a, b) => sign * compare[q.sort](a, b) || a.sku.localeCompare(b.sku));

	const start = (q.page - 1) * q.pageSize;
	return {
		items: items.slice(start, start + q.pageSize).map(strip),
		total: items.length,
		page: q.page,
		pageSize: q.pageSize
	};
}

/** GET /api/lookup, answered from the offline copy (same rules as the server). */
export async function localLookup(code: string): Promise<LookupResult> {
	const label = /^(?:https?:\/\/[^/]+)?\/(i|l|p)\/([^/?#]+)\/?(?:[?#].*)?$/i.exec(code.trim());
	const items = await allItems();
	const locations = await localLocations();
	if (label) {
		const kind = label[1]!.toLowerCase();
		const value = decodeURIComponent(label[2]!);
		if (kind === 'i') return { type: 'item', item: await localItem(value) };
		if (kind === 'l') {
			const location = locations.find((l) => l.code === value);
			if (location) return { type: 'location', location };
		} else {
			const project = (await localProjects()).find((p) => String(p.id) === value);
			if (project) return { type: 'project', project };
		}
		throw new ApiError(404, 'not_found', `Code "${code}" not found`);
	}
	const text = code.trim();
	const item = items.find((i) => i.sku === text) ?? items.find((i) => i.barcode === text);
	if (item) return { type: 'item', item: strip(item) };
	const location = locations.find((l) => l.code === text);
	if (location) return { type: 'location', location };
	throw new ApiError(404, 'not_found', `Code "${code}" not found`);
}

/** Keep the offline copy of one item current after an online read or a stock change. */
export async function updateLocalItem(
	sku: string,
	update: (item: ItemWithAvailability) => ItemWithAvailability
): Promise<ItemWithAvailability | undefined> {
	if (!available()) return undefined;
	return transaction(['items'], 'readwrite', async (tx) => {
		const store = tx.objectStore('items');
		const current = await new Promise<StoredItem | undefined>((resolve, reject) => {
			const r = store.get(sku);
			r.onsuccess = () => resolve(r.result as StoredItem | undefined);
			r.onerror = () => reject(r.error);
		});
		if (!current) return undefined;
		const next = { ...update(strip(current)), searchText: current.searchText };
		store.put(next);
		return strip(next);
	});
}
