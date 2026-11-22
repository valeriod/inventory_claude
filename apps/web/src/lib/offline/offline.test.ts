import 'fake-indexeddb/auto';
import type { CategoryWithFields, ItemWithAvailability, Location } from '@inventory/shared';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api.ts';
import { localItems, localLookup, syncCatalogue } from './catalogue.ts';
import { resetConnection } from './idb.ts';
import { outboxEntries, replayOutbox } from './outbox.ts';

const category = (id: number, name: string, parentId: number | null): CategoryWithFields => ({
	id,
	name,
	parentId,
	skuPrefix: null,
	unitKind: id === 3 ? 'length' : 'count',
	displayUnit: id === 3 ? 'm' : 'pcs',
	fieldDefs: [],
	resolvedFieldDefs: [
		{
			key: 'value',
			order: 0,
			label: 'Value',
			type: 'text',
			required: false,
			filterable: false,
			showInList: false,
			searchable: true,
			categoryId: id,
			inherited: false
		}
	],
	createdAt: '',
	updatedAt: ''
});

const item = (sku: string, over: Partial<ItemWithAvailability>): ItemWithAvailability => ({
	sku,
	categoryId: 2,
	name: sku,
	description: null,
	qtyOnHand: 10,
	qtyMin: null,
	locationId: null,
	barcode: null,
	attributes: {},
	version: 1,
	archivedAt: null,
	createdAt: '2026-01-01T00:00:00Z',
	updatedAt: '2026-01-01T00:00:00Z',
	qtyReserved: 0,
	qtyAvailable: 10,
	...over
});

const CATEGORIES = [
	category(1, 'Electronics', null),
	category(2, 'Resistors', 1),
	category(3, 'Wire', null)
];
const LOCATIONS: Location[] = [
	{
		id: 1,
		name: 'Shelf',
		parentId: null,
		code: 'S1',
		description: null,
		createdAt: '',
		updatedAt: ''
	},
	{ id: 2, name: 'Bin', parentId: 1, code: 'B1', description: null, createdAt: '', updatedAt: '' }
];
const ITEMS = [
	item('RES-1', { name: '10kΩ resistor', attributes: { value: '0603' }, locationId: 2 }),
	item('RES-2', { name: '220Ω resistor', qtyMin: 20, qtyAvailable: 5, qtyOnHand: 5 }),
	item('WIR-1', {
		name: 'Hookup wire red',
		categoryId: 3,
		barcode: '4006381333931',
		qtyOnHand: 5000,
		qtyAvailable: 5000
	}),
	item('OLD-1', { name: 'Old resistor', archivedAt: '2026-01-02T00:00:00Z' })
];

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;
let handler: Handler;
const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const serverUp: Handler = (url) => {
	if (url.pathname === '/api/categories') return json(CATEGORIES);
	if (url.pathname === '/api/locations') return json(LOCATIONS);
	if (url.pathname === '/api/projects') return json([]);
	if (url.pathname === '/api/items') {
		return json({ items: ITEMS, total: ITEMS.length, page: 1, pageSize: 200 });
	}
	return json({ error: { code: 'not_found', message: 'nope' } }, 404);
};
const serverDown: Handler = () => {
	throw new TypeError('Failed to fetch');
};

beforeEach(() => {
	globalThis.indexedDB = new IDBFactory();
	resetConnection();
	handler = serverUp;
	vi.stubGlobal('fetch', (input: string, init: RequestInit = {}) =>
		Promise.resolve().then(() => handler(new URL(input, 'http://app.test'), init))
	);
});
afterEach(() => vi.unstubAllGlobals());

describe('offline catalogue', () => {
	it('searches, filters and pages like the server', async () => {
		const meta = await syncCatalogue();
		expect(meta.items).toBe(4);

		const search = await localItems(new URLSearchParams('q=resist'));
		expect(search.items.map((i) => i.sku)).toEqual(['RES-1', 'RES-2']); // archived excluded
		expect((await localItems(new URLSearchParams('q=060'))).items.map((i) => i.sku)).toEqual([
			'RES-1'
		]);
		expect((await localItems(new URLSearchParams('q=10k resistor'))).total).toBe(1);

		const electronics = await localItems(new URLSearchParams('category=1&includeArchived=true'));
		expect(electronics.total).toBe(3);
		expect((await localItems(new URLSearchParams('location=1'))).items.map((i) => i.sku)).toEqual([
			'RES-1'
		]);
		expect(
			(await localItems(new URLSearchParams('lowStock=true'))).items.map((i) => i.sku)
		).toEqual(['RES-2']);

		const page2 = await localItems(new URLSearchParams('sort=sku&pageSize=2&page=2'));
		expect(page2).toMatchObject({ total: 3, page: 2 });
		expect(page2.items.map((i) => i.sku)).toEqual(['WIR-1']);

		await expect(localItems(new URLSearchParams('attr.value=0603'))).rejects.toThrow(
			/custom fields/
		);
	});

	it('looks up labels, barcodes and bin codes', async () => {
		await syncCatalogue();
		expect(await localLookup('https://inv.example/i/RES-1')).toMatchObject({
			type: 'item',
			item: { sku: 'RES-1' }
		});
		expect(await localLookup('4006381333931')).toMatchObject({
			type: 'item',
			item: { sku: 'WIR-1' }
		});
		expect(await localLookup('/l/B1')).toMatchObject({
			type: 'location',
			location: { code: 'B1' }
		});
		expect(await localLookup('S1')).toMatchObject({ type: 'location' });
		await expect(localLookup('NOPE')).rejects.toMatchObject({ status: 404 });
	});

	it('answers API reads from the offline copy when the server is down', async () => {
		await syncCatalogue();
		handler = serverDown;
		expect((await api.items.list('q=wire')).items.map((i) => i.sku)).toEqual(['WIR-1']);
		expect((await api.items.get('RES-1')).name).toBe('10kΩ resistor');
		expect(await api.items.movements('RES-1')).toEqual([]);
		expect((await api.lookup('B1')).type).toBe('location');
		expect((await api.categories.list()).length).toBe(3);
	});

	it('reports the network error when nothing is saved offline', async () => {
		handler = serverDown;
		await expect(api.items.list('q=wire')).rejects.toMatchObject({ status: 0, code: 'network' });
	});
});

describe('outbox', () => {
	it('queues stock changes offline and sends them once with an idempotency key', async () => {
		await syncCatalogue();
		handler = serverDown;
		const result = await api.items.addMovement('WIR-1', { reason: 'consume', delta: -500 });
		expect(result).toEqual({ qtyOnHand: 4500, movement: null, queued: true });
		expect((await api.items.get('WIR-1')).qtyOnHand).toBe(4500);
		await api.items.count('RES-1', { countedQty: 7 });
		await expect(
			api.items.addMovement('RES-2', { reason: 'consume', delta: -6 })
		).rejects.toMatchObject({
			status: 409
		});

		const queued = await outboxEntries();
		expect(queued.map((e) => [e.kind, e.sku, e.unit?.displayUnit])).toEqual([
			['movement', 'WIR-1', 'm'],
			['count', 'RES-1', 'pcs']
		]);

		// Still offline: nothing is sent and nothing is lost.
		expect(await replayOutbox()).toEqual({ sent: 0, failed: 0, stopped: 'offline' });

		const seen: { path: string; key: string | null }[] = [];
		handler = (url, init) => {
			seen.push({ path: url.pathname, key: new Headers(init.headers).get('idempotency-key') });
			if (url.pathname.endsWith('/count')) {
				return json({ error: { code: 'not_found', message: 'Item "RES-1" not found' } }, 404);
			}
			return json({ qtyOnHand: 4400, movement: null }, 201);
		};
		expect(await replayOutbox()).toEqual({ sent: 1, failed: 1 });
		expect(seen.map((s) => s.path)).toEqual([
			'/api/items/WIR-1/movements',
			'/api/items/RES-1/count'
		]);
		expect(seen[0]!.key).toBe(queued[0]!.id);

		const left = await outboxEntries();
		expect(left).toHaveLength(1);
		expect(left[0]).toMatchObject({
			kind: 'count',
			status: 'failed',
			error: 'Item "RES-1" not found'
		});
		// The offline copy follows the server's answer.
		handler = serverDown;
		expect((await api.items.get('WIR-1')).qtyOnHand).toBe(4400);
	});

	it('stops when the session has expired', async () => {
		await syncCatalogue();
		handler = serverDown;
		await api.items.addMovement('WIR-1', { reason: 'receive', delta: 100 });
		handler = () => json({ error: { code: 'unauthorized', message: 'Log in' } }, 401);
		expect(await replayOutbox()).toEqual({ sent: 0, failed: 0, stopped: 'unauthorized' });
		expect((await outboxEntries())[0]!.status).toBe('pending');
	});
});
