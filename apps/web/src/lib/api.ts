import type {
	Category,
	CategoryWithFields,
	CreateCategoryRequest,
	CreateItemRequest,
	CreateLocationRequest,
	HealthResponse,
	ItemListResponse,
	ItemWithAvailability,
	Location,
	LookupResult,
	BomLine,
	ImportResult,
	ProjectPart,
	Report,
	ReportKind,
	SetProjectPartRequest,
	PickLine,
	ProjectSummary,
	Reservation,
	ReservationWithProject,
	ReserveRequest,
	CreateProjectRequest,
	UpdateProjectRequest,
	UpdateReservationRequest,
	StockCountRequest,
	StockMovement,
	StockMovementRequest,
	UpdateCategoryRequest,
	UpdateItemRequest,
	UpdateLocationRequest
} from '@inventory/shared';
import { ApiError, request, type Fetch } from './http.ts';
import {
	localCategories,
	localItem,
	localItems,
	localLocations,
	localLookup,
	localProjects,
	NotAvailableOffline,
	updateLocalItem
} from './offline/catalogue.ts';
import { enqueue } from './offline/outbox.ts';
import { refreshOfflineState } from './offline/status.svelte.ts';

export { ApiError, type Fetch };

export interface SessionResponse {
	authRequired: boolean;
	authenticated: boolean;
}

export interface StockChangeResponse {
	qtyOnHand: number;
	movement: StockMovement | null;
	/** Saved offline; it will be sent when the server is reachable again. */
	queued?: boolean;
}

const enc = encodeURIComponent;

const isNetworkError = (err: unknown) => err instanceof ApiError && err.status === 0;

/**
 * Try the server; when it cannot be reached, answer from the offline catalogue. If the offline
 * copy has nothing either, the original "cannot reach the server" error is thrown.
 */
async function withOffline<T>(online: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
	try {
		return await online();
	} catch (err) {
		if (!isNetworkError(err)) throw err;
		try {
			return await fallback();
		} catch (fallbackError) {
			throw fallbackError instanceof NotAvailableOffline ? err : fallbackError;
		}
	}
}

const SESSION_KEY = 'inventory.session';

function rememberSession(session: SessionResponse): SessionResponse {
	try {
		localStorage.setItem(SESSION_KEY, JSON.stringify(session));
	} catch {
		// Storage unavailable; offline start-up will just need the server.
	}
	return session;
}

function lastSession(): SessionResponse {
	try {
		const saved = localStorage.getItem(SESSION_KEY);
		if (saved) return JSON.parse(saved) as SessionResponse;
	} catch {
		// fall through
	}
	throw new NotAvailableOffline();
}

/** Keep the offline copy of an item in step with a stock change the server confirmed. */
function trackStock(sku: string, result: StockChangeResponse): StockChangeResponse {
	void updateLocalItem(sku, (i) => ({
		...i,
		qtyOnHand: result.qtyOnHand,
		qtyAvailable: result.qtyOnHand - i.qtyReserved
	})).catch(() => {});
	return result;
}

/** Record a stock change offline: queue it and update the offline copy of the item. */
async function queueStockChange(
	sku: string,
	change:
		{ kind: 'movement'; body: StockMovementRequest } | { kind: 'count'; body: StockCountRequest }
): Promise<StockChangeResponse> {
	const item = await localItem(sku);
	const qtyOnHand =
		change.kind === 'movement' ? item.qtyOnHand + change.body.delta : change.body.countedQty;
	if (qtyOnHand < 0) {
		throw new ApiError(
			409,
			'insufficient_stock',
			`Not enough stock: the offline copy shows ${item.qtyOnHand} base units on hand`
		);
	}
	const category = (await localCategories().catch(() => [])).find((c) => c.id === item.categoryId);
	await enqueue({
		...change,
		id: crypto.randomUUID(),
		sku,
		itemName: item.name,
		...(category && {
			unit: { unitKind: category.unitKind, displayUnit: category.displayUnit }
		}),
		createdAt: new Date().toISOString(),
		status: 'pending'
	});
	await updateLocalItem(sku, (i) => ({
		...i,
		qtyOnHand,
		qtyAvailable: qtyOnHand - i.qtyReserved
	}));
	await refreshOfflineState();
	return { qtyOnHand, movement: null, queued: true };
}

/** A stock change: sent now, or queued when the server cannot be reached. */
async function stockChange(
	sku: string,
	change:
		{ kind: 'movement'; body: StockMovementRequest } | { kind: 'count'; body: StockCountRequest }
): Promise<StockChangeResponse> {
	const path = `/items/${enc(sku)}/${change.kind === 'movement' ? 'movements' : 'count'}`;
	try {
		return trackStock(
			sku,
			await request<StockChangeResponse>(path, { method: 'POST', body: change.body })
		);
	} catch (err) {
		if (!isNetworkError(err)) throw err;
		try {
			return await queueStockChange(sku, change);
		} catch (offlineError) {
			throw offlineError instanceof NotAvailableOffline ? err : offlineError;
		}
	}
}

/** Report query string: filters plus format and the browser's time zone (for PDF dates). */
function reportParams(query: URLSearchParams, format: string): string {
	const params = new URLSearchParams(query);
	params.delete('report');
	params.delete('project');
	params.set('format', format);
	params.set('tz', Intl.DateTimeFormat().resolvedOptions().timeZone);
	return params.toString();
}

export const api = {
	health: (f?: Fetch) => request<HealthResponse>('/health', { fetch: f }),

	session: (f?: Fetch) =>
		withOffline(
			async () => rememberSession(await request<SessionResponse>('/auth/session', { fetch: f })),
			async () => lastSession()
		),
	login: (password: string) =>
		request<SessionResponse>('/auth/login', { method: 'POST', body: { password } }),
	logout: () => request<SessionResponse>('/auth/logout', { method: 'POST' }),

	categories: {
		list: (f?: Fetch) =>
			withOffline(
				() => request<CategoryWithFields[]>('/categories', { fetch: f }),
				localCategories
			),
		get: (id: number, f?: Fetch) =>
			withOffline(
				() => request<CategoryWithFields>(`/categories/${id}`, { fetch: f }),
				async () => {
					const category = (await localCategories()).find((c) => c.id === id);
					if (!category) throw new ApiError(404, 'not_found', `Category ${id} not found`);
					return category;
				}
			),
		create: (body: CreateCategoryRequest) =>
			request<CategoryWithFields>('/categories', { method: 'POST', body }),
		update: (id: number, body: UpdateCategoryRequest) =>
			request<CategoryWithFields>(`/categories/${id}`, { method: 'PATCH', body }),
		remove: (id: number) => request<void>(`/categories/${id}`, { method: 'DELETE' }),
		renameField: (id: number, key: string, newKey: string) =>
			request<CategoryWithFields>(`/categories/${id}/fields/${enc(key)}/rename`, {
				method: 'POST',
				body: { newKey }
			})
	},

	items: {
		/** `query` uses the API's query syntax, e.g. "q=wire&attr.color=red". */
		list: (query: string | URLSearchParams, f?: Fetch) =>
			withOffline(
				() => request<ItemListResponse>(`/items?${query.toString()}`, { fetch: f }),
				() => localItems(new URLSearchParams(query.toString()))
			),
		get: (sku: string, f?: Fetch) =>
			withOffline(
				async () => {
					const item = await request<ItemWithAvailability>(`/items/${enc(sku)}`, { fetch: f });
					void updateLocalItem(sku, () => item).catch(() => {});
					return item;
				},
				() => localItem(sku)
			),
		create: (body: CreateItemRequest) =>
			request<ItemWithAvailability>('/items', { method: 'POST', body }),
		update: (sku: string, body: UpdateItemRequest, version?: number) =>
			request<ItemWithAvailability>(`/items/${enc(sku)}`, {
				method: 'PATCH',
				body,
				headers: version === undefined ? {} : { 'if-match': `"${version}"` }
			}),
		archive: (sku: string) =>
			request<ItemWithAvailability>(`/items/${enc(sku)}`, { method: 'DELETE' }),
		restore: (sku: string) =>
			request<ItemWithAvailability>(`/items/${enc(sku)}/restore`, { method: 'POST' }),
		deletePermanently: (sku: string) =>
			request<void>(`/items/${enc(sku)}?permanent=true`, { method: 'DELETE' }),
		/** Offline: empty (history is not kept in the offline copy). */
		movements: (sku: string, limit = 50, f?: Fetch) =>
			withOffline(
				() => request<StockMovement[]>(`/items/${enc(sku)}/movements?limit=${limit}`, { fetch: f }),
				async () => []
			),
		addMovement: (sku: string, body: StockMovementRequest) =>
			stockChange(sku, { kind: 'movement', body }),
		count: (sku: string, body: StockCountRequest) => stockChange(sku, { kind: 'count', body }),
		/** Offline: empty. */
		reservations: (sku: string, f?: Fetch) =>
			withOffline(
				() => request<ReservationWithProject[]>(`/items/${enc(sku)}/reservations`, { fetch: f }),
				async () => []
			)
	},

	locations: {
		list: (f?: Fetch) =>
			withOffline(() => request<Location[]>('/locations', { fetch: f }), localLocations),
		create: (body: CreateLocationRequest) =>
			request<Location>('/locations', { method: 'POST', body }),
		update: (id: number, body: UpdateLocationRequest) =>
			request<Location>(`/locations/${id}`, { method: 'PATCH', body }),
		remove: (id: number) => request<void>(`/locations/${id}`, { method: 'DELETE' })
	},

	projects: {
		/** `status` filters, e.g. ['planning', 'active']; empty for all. */
		list: (status: string[] = [], f?: Fetch) =>
			withOffline(
				() =>
					request<ProjectSummary[]>(
						status.length ? `/projects?status=${status.join(',')}` : '/projects',
						{ fetch: f }
					),
				async () =>
					(await localProjects()).filter((p) => !status.length || status.includes(p.status))
			),
		get: (id: number, f?: Fetch) => request<ProjectSummary>(`/projects/${id}`, { fetch: f }),
		create: (body: CreateProjectRequest) =>
			request<ProjectSummary>('/projects', { method: 'POST', body }),
		update: (id: number, body: UpdateProjectRequest) =>
			request<ProjectSummary>(`/projects/${id}`, { method: 'PATCH', body }),
		remove: (id: number) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
		lines: (id: number, f?: Fetch) =>
			request<PickLine[]>(`/projects/${id}/reservations`, { fetch: f }),
		reserve: (id: number, body: ReserveRequest) =>
			request<Reservation>(`/projects/${id}/reservations`, { method: 'POST', body }),
		consumeAll: (id: number, note?: string | null) =>
			request<{ consumed: number }>(`/projects/${id}/consume-all`, {
				method: 'POST',
				body: { note: note ?? null }
			}),
		releaseAll: (id: number) =>
			request<{ released: number }>(`/projects/${id}/release-all`, { method: 'POST' }),
		bom: (id: number, f?: Fetch) => request<BomLine[]>(`/projects/${id}/bom`, { fetch: f }),
		setPart: (id: number, sku: string, body: SetProjectPartRequest) =>
			request<ProjectPart>(`/projects/${id}/parts/${enc(sku)}`, { method: 'PUT', body }),
		removePart: (id: number, sku: string) =>
			request<void>(`/projects/${id}/parts/${enc(sku)}`, { method: 'DELETE' }),
		reserveNeeded: (id: number) =>
			request<{ reserved: number }>(`/projects/${id}/reserve-needed`, { method: 'POST' })
	},

	reports: {
		/** `query` holds report filters, e.g. { category: '3' }. */
		get: (kind: ReportKind, query: URLSearchParams, f?: Fetch) => {
			const path = kind === 'project' ? `project/${query.get('project') ?? ''}` : kind;
			return request<Report>(`/reports/${path}?${reportParams(query, 'json')}`, { fetch: f });
		},
		/** Download URL (CSV/PDF), opened rather than fetched. */
		url: (kind: ReportKind, query: URLSearchParams, format: 'csv' | 'pdf'): string => {
			const path = kind === 'project' ? `project/${query.get('project') ?? ''}` : kind;
			return `/api/reports/${path}?${reportParams(query, format)}`;
		}
	},

	reservations: {
		update: (id: number, body: UpdateReservationRequest) =>
			request<Reservation>(`/reservations/${id}`, { method: 'PATCH', body })
	},

	lookup: (code: string, f?: Fetch) =>
		withOffline(
			() => request<LookupResult>(`/lookup?code=${enc(code)}`, { fetch: f }),
			() => localLookup(code)
		),

	system: (f?: Fetch) =>
		request<{
			version: string;
			database: 'sqlite' | 'postgres';
			publicUrl: string | null;
			backup: {
				dir: string;
				keep: number;
				hour: number;
				lastBackup: { file: string; at: string } | null;
			} | null;
		}>('/system', { fetch: f }),
	/** CSV import: a dry run unless `commit` (and nothing is written if any row has errors). */
	importItems: async (
		csv: string,
		options: { category?: number | null; updateStock: boolean; commit: boolean }
	): Promise<ImportResult> => {
		const params = new URLSearchParams({
			updateStock: String(options.updateStock),
			commit: String(options.commit)
		});
		if (options.category) params.set('category', String(options.category));
		try {
			return await request<ImportResult>(`/import/items?${params}`, {
				method: 'POST',
				text: csv,
				contentType: 'text/csv'
			});
		} catch (err) {
			// 422: the commit was refused because a row became invalid since the check.
			if (err instanceof ApiError && err.status === 422) {
				throw new ApiError(
					422,
					'invalid_operation',
					'Some rows are no longer valid. Check the file again.'
				);
			}
			throw err;
		}
	},
	exportUrl: (format: 'json' | 'csv') => `/api/export?format=${format}`,
	importTemplateUrl: (category: number) => `/api/import/template?category=${category}`,

	labelInfo: (f?: Fetch) =>
		request<{ baseUrl: string; configured: boolean }>('/labels/info', { fetch: f }),
	/** URL of the label PDF (opened in a new tab rather than fetched). */
	labelsUrl: (options: {
		skus?: string[];
		locations?: string[];
		projects?: number[];
		layout: string;
		skip?: number;
		outline?: boolean;
	}): string => {
		const params = new URLSearchParams({ layout: options.layout });
		if (options.skus?.length) params.set('skus', options.skus.join(','));
		if (options.locations?.length) params.set('locations', options.locations.join(','));
		if (options.projects?.length) params.set('projects', options.projects.join(','));
		if (options.skip) params.set('skip', String(options.skip));
		if (options.outline) params.set('outline', 'true');
		return `/api/labels?${params.toString()}`;
	}
};

export type { Category };
