/**
 * Minimal promise wrapper around IndexedDB for the offline catalogue and outbox (no dependency).
 * Stores: `kv` (small values by key), `items` (by SKU), `outbox` (queued stock changes by id).
 */
const DB_NAME = 'inventory-offline';
const DB_VERSION = 1;

export type StoreName = 'kv' | 'items' | 'outbox';

let opening: Promise<IDBDatabase> | null = null;

export function available(): boolean {
	return typeof indexedDB !== 'undefined';
}

function open(): Promise<IDBDatabase> {
	opening ??= new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
			if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'sku' });
			if (!db.objectStoreNames.contains('outbox'))
				db.createObjectStore('outbox', { keyPath: 'id' });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => {
			opening = null;
			reject(request.error);
		};
	});
	return opening;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/** Run `fn` in one transaction and resolve once it has committed. */
export async function transaction<T>(
	stores: StoreName[],
	mode: IDBTransactionMode,
	fn: (tx: IDBTransaction) => T | Promise<T>
): Promise<T> {
	const db = await open();
	const tx = db.transaction(stores, mode);
	const committed = new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
	});
	const result = await fn(tx);
	await committed;
	return result;
}

export function get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
	return transaction([store], 'readonly', (tx) => done(tx.objectStore(store).get(key)));
}

export function getAll<T>(store: StoreName): Promise<T[]> {
	return transaction([store], 'readonly', (tx) => done(tx.objectStore(store).getAll()));
}

export function put(store: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
	return transaction([store], 'readwrite', (tx) => {
		tx.objectStore(store).put(value, key);
	});
}

export function remove(store: StoreName, key: IDBValidKey): Promise<void> {
	return transaction([store], 'readwrite', (tx) => {
		tx.objectStore(store).delete(key);
	});
}

/** Test helper: forget the open connection (fake-indexeddb is reset between tests). */
export function resetConnection(): void {
	opening = null;
}
