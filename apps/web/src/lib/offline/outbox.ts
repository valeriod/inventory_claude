import type { StockCountRequest, StockMovementRequest, UnitKind } from '@inventory/shared';
import { ApiError, request } from '../http.ts';
import { updateLocalItem } from './catalogue.ts';
import { available, getAll, put, remove } from './idb.ts';

/**
 * Stock changes made while the server was unreachable (plan §6.4). Each entry is sent later with
 * its id as `Idempotency-Key`, so a change that reached the server before the connection dropped
 * is not applied twice. Movements are deltas and merge safely with changes made elsewhere;
 * counts set the counted quantity when they arrive.
 */
export type OutboxEntry = {
	id: string;
	sku: string;
	itemName: string;
	/** For display: the item's unit when the change was made. */
	unit?: { unitKind: UnitKind; displayUnit: string };
	createdAt: string;
	status: 'pending' | 'failed';
	error?: string;
} & ({ kind: 'movement'; body: StockMovementRequest } | { kind: 'count'; body: StockCountRequest });

export async function outboxEntries(): Promise<OutboxEntry[]> {
	if (!available()) return [];
	const entries = await getAll<OutboxEntry>('outbox');
	return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export async function enqueue(entry: OutboxEntry): Promise<void> {
	await put('outbox', entry);
}

export async function discard(id: string): Promise<void> {
	await remove('outbox', id);
}

export async function retry(id: string): Promise<void> {
	const entry = (await outboxEntries()).find((e) => e.id === id);
	if (entry) await put('outbox', { ...entry, status: 'pending', error: undefined });
}

export interface ReplayResult {
	sent: number;
	failed: number;
	/** Why sending stopped early: the server is unreachable or the session has expired. */
	stopped?: 'offline' | 'unauthorized';
}

let running: Promise<ReplayResult> | null = null;

/** Send pending entries in the order they were made. Safe to call often; runs one at a time. */
export function replayOutbox(): Promise<ReplayResult> {
	running ??= (async (): Promise<ReplayResult> => {
		const result: ReplayResult = { sent: 0, failed: 0 };
		for (const entry of await outboxEntries()) {
			if (entry.status !== 'pending') continue;
			const path =
				entry.kind === 'movement'
					? `/items/${encodeURIComponent(entry.sku)}/movements`
					: `/items/${encodeURIComponent(entry.sku)}/count`;
			try {
				const response = await request<{ qtyOnHand: number }>(path, {
					method: 'POST',
					body: entry.body,
					headers: { 'idempotency-key': entry.id }
				});
				await discard(entry.id);
				await updateLocalItem(entry.sku, (i) => ({
					...i,
					qtyOnHand: response.qtyOnHand,
					qtyAvailable: response.qtyOnHand - i.qtyReserved
				}));
				result.sent++;
			} catch (err) {
				if (err instanceof ApiError && err.status === 0) return { ...result, stopped: 'offline' };
				if (err instanceof ApiError && err.status === 401) {
					return { ...result, stopped: 'unauthorized' };
				}
				await put('outbox', {
					...entry,
					status: 'failed',
					error: err instanceof Error ? err.message : String(err)
				});
				result.failed++;
			}
		}
		return result;
	})().finally(() => {
		running = null;
	});
	return running!;
}
