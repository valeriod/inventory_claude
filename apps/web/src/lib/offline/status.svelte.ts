import { onReachability } from '../http.ts';
import { catalogueMeta, syncCatalogue } from './catalogue.ts';
import { outboxEntries, replayOutbox } from './outbox.ts';

/** Offline state shown in the app chrome and on /sync. */
export const offline = $state({
	/** Whether the last request reached the server. */
	reachable: true,
	syncedAt: null as string | null,
	items: 0,
	pending: 0,
	failed: 0,
	syncing: false,
	/** Queued changes are waiting because the session expired. */
	needsLogin: false,
	error: null as string | null
});

let started = false;

// Subscribe as soon as the module loads (the API client imports it), so failures during
// start-up, before the layout mounts, are not missed.
onReachability((reachable) => {
	const regained = reachable && !offline.reachable;
	offline.reachable = reachable;
	if (regained && started) void syncNow();
});

/** Refresh the catalogue at most this often in the background. */
const CATALOGUE_MAX_AGE_MS = 5 * 60_000;
/** How often to try again while unreachable or with changes waiting. */
const RETRY_MS = 30_000;

export async function refreshOfflineState(): Promise<void> {
	try {
		const [meta, entries] = await Promise.all([catalogueMeta(), outboxEntries()]);
		offline.syncedAt = meta?.syncedAt ?? null;
		offline.items = meta?.items ?? 0;
		offline.pending = entries.filter((e) => e.status === 'pending').length;
		offline.failed = entries.filter((e) => e.status === 'failed').length;
	} catch {
		// IndexedDB unavailable (e.g. some private modes): offline support is simply off.
	}
}

/** Send queued changes, then refresh the catalogue if it is stale (or `force`). */
export async function syncNow(force = false): Promise<void> {
	if (offline.syncing) return;
	offline.syncing = true;
	offline.error = null;
	try {
		const replay = await replayOutbox();
		offline.needsLogin = replay.stopped === 'unauthorized';
		if (replay.stopped) return;
		const meta = await catalogueMeta();
		const age = meta ? Date.now() - Date.parse(meta.syncedAt) : Infinity;
		if (force || age > CATALOGUE_MAX_AGE_MS) await syncCatalogue();
	} catch (err) {
		offline.error = err instanceof Error ? err.message : String(err);
	} finally {
		offline.syncing = false;
		await refreshOfflineState();
	}
}

/** Start background sync; returns a function that stops it. */
export function startOfflineSupport(): () => void {
	started = true;
	void refreshOfflineState().then(() => syncNow());
	const onOnline = () => void syncNow();
	window.addEventListener('online', onOnline);
	let ticks = 0;
	const timer = setInterval(() => {
		ticks++;
		const waiting = !offline.reachable || offline.pending > 0;
		// Every 30 s while something is waiting, otherwise every 5 minutes.
		if (waiting || ticks % (CATALOGUE_MAX_AGE_MS / RETRY_MS) === 0) void syncNow();
	}, RETRY_MS);
	return () => {
		started = false;
		window.removeEventListener('online', onOnline);
		clearInterval(timer);
	};
}
