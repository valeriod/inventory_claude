import type { ApiErrorBody } from '@inventory/shared';

export type Fetch = typeof fetch;

/**
 * Whether the last request reached the server. `navigator.onLine` is not enough: a phone on the
 * shop Wi-Fi is "online" even when the server is down or out of reach.
 */
const reachabilityListeners = new Set<(reachable: boolean) => void>();
export function onReachability(listener: (reachable: boolean) => void): () => void {
	reachabilityListeners.add(listener);
	return () => reachabilityListeners.delete(listener);
}
function reportReachable(reachable: boolean) {
	for (const listener of reachabilityListeners) listener(reachable);
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

export interface RequestOptions {
	method?: string;
	body?: unknown;
	headers?: Record<string, string>;
	fetch?: Fetch;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
	const { method = 'GET', body, headers = {}, fetch: f = fetch } = options;
	let res: Response;
	try {
		res = await f(`/api${path}`, {
			method,
			headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
	} catch {
		reportReachable(false);
		throw new ApiError(0, 'network', 'Cannot reach the server. Check your connection.');
	}
	reportReachable(true);
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
