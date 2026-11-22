import type {
	ApiErrorBody,
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

export type Fetch = typeof fetch;

export interface SessionResponse {
	authRequired: boolean;
	authenticated: boolean;
}

export interface StockChangeResponse {
	qtyOnHand: number;
	movement: StockMovement | null;
}

/** Error returned by the API, carrying the `{ error: { code, message, details } }` body. */
export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: ApiErrorBody['error']['code'] | 'network',
		message: string,
		readonly details?: unknown
	) {
		super(message);
		this.name = 'ApiError';
	}

	/** Validation details as `{ path, message }`, e.g. path `attributes.color` or `name`. */
	get fieldErrors(): Record<string, string> {
		if (!Array.isArray(this.details)) return {};
		const out: Record<string, string> = {};
		for (const d of this.details as { path?: unknown; message?: unknown }[]) {
			if (typeof d.path === 'string' && typeof d.message === 'string' && !(d.path in out)) {
				out[d.path] = d.message;
			}
		}
		return out;
	}
}

interface RequestOptions {
	method?: string;
	body?: unknown;
	headers?: Record<string, string>;
	fetch?: Fetch;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
	const { method = 'GET', body, headers = {}, fetch: f = fetch } = options;
	let res: Response;
	try {
		res = await f(`/api${path}`, {
			method,
			headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
	} catch {
		throw new ApiError(0, 'network', 'Cannot reach the server. Check your connection.');
	}
	if (res.status === 204) return undefined as T;
	const data: unknown = await res.json().catch(() => null);
	if (!res.ok) {
		const err = (data as ApiErrorBody | null)?.error;
		throw new ApiError(
			res.status,
			err?.code ?? 'internal',
			err?.message ?? res.statusText,
			err?.details
		);
	}
	return data as T;
}

const enc = encodeURIComponent;

export const api = {
	health: (f?: Fetch) => request<HealthResponse>('/health', { fetch: f }),

	session: (f?: Fetch) => request<SessionResponse>('/auth/session', { fetch: f }),
	login: (password: string) =>
		request<SessionResponse>('/auth/login', { method: 'POST', body: { password } }),
	logout: () => request<SessionResponse>('/auth/logout', { method: 'POST' }),

	categories: {
		list: (f?: Fetch) => request<CategoryWithFields[]>('/categories', { fetch: f }),
		get: (id: number, f?: Fetch) => request<CategoryWithFields>(`/categories/${id}`, { fetch: f }),
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
			request<ItemListResponse>(`/items?${query.toString()}`, { fetch: f }),
		get: (sku: string, f?: Fetch) =>
			request<ItemWithAvailability>(`/items/${enc(sku)}`, { fetch: f }),
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
		movements: (sku: string, limit = 50, f?: Fetch) =>
			request<StockMovement[]>(`/items/${enc(sku)}/movements?limit=${limit}`, { fetch: f }),
		addMovement: (sku: string, body: StockMovementRequest) =>
			request<StockChangeResponse>(`/items/${enc(sku)}/movements`, { method: 'POST', body }),
		count: (sku: string, body: StockCountRequest) =>
			request<StockChangeResponse>(`/items/${enc(sku)}/count`, { method: 'POST', body }),
		reservations: (sku: string, f?: Fetch) =>
			request<ReservationWithProject[]>(`/items/${enc(sku)}/reservations`, { fetch: f })
	},

	locations: {
		list: (f?: Fetch) => request<Location[]>('/locations', { fetch: f }),
		create: (body: CreateLocationRequest) =>
			request<Location>('/locations', { method: 'POST', body }),
		update: (id: number, body: UpdateLocationRequest) =>
			request<Location>(`/locations/${id}`, { method: 'PATCH', body }),
		remove: (id: number) => request<void>(`/locations/${id}`, { method: 'DELETE' })
	},

	projects: {
		/** `status` filters, e.g. ['planning', 'active']; empty for all. */
		list: (status: string[] = [], f?: Fetch) =>
			request<ProjectSummary[]>(
				status.length ? `/projects?status=${status.join(',')}` : '/projects',
				{ fetch: f }
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
			request<{ released: number }>(`/projects/${id}/release-all`, { method: 'POST' })
	},

	reservations: {
		update: (id: number, body: UpdateReservationRequest) =>
			request<Reservation>(`/reservations/${id}`, { method: 'PATCH', body })
	},

	lookup: (code: string, f?: Fetch) =>
		request<LookupResult>(`/lookup?code=${enc(code)}`, { fetch: f }),

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
