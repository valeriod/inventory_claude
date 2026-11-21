import type {
	ApiErrorBody,
	ItemListResponse,
	ItemWithAvailability,
	LookupResult,
	StockMovement
} from '@inventory/shared';
import { describe, expect, it } from 'vitest';
import { json, useApi } from './test-helpers.ts';

type ValidationDetails = { path: string; message: string }[];

describe('items API (seeded)', () => {
	const fx = useApi({ seed: true });

	async function categoryId(name: string) {
		return (await fx().repos.categories.list()).find((c) => c.name === name)!.id;
	}
	async function locationId(code: string) {
		return (await fx().repos.locations.findByCode(code))!.id;
	}
	async function list(query: string) {
		const res = await fx().app.request(`/api/items${query}`);
		expect(res.status).toBe(200);
		return json<ItemListResponse>(res);
	}
	const skus = (page: ItemListResponse) => page.items.map((i) => i.sku);

	describe('GET /api/items', () => {
		it('lists with pagination metadata', async () => {
			const page = await list('?sort=sku&pageSize=4&page=2');
			expect(page).toMatchObject({ total: 11, page: 2, pageSize: 4 });
			// CAP-0001, CAP-0002, IC-0001, RES-0001 | RES-0002, RES-0003, TOL-0001, TOL-0002 | …
			expect(skus(page)).toEqual(['RES-0002', 'RES-0003', 'TOL-0001', 'TOL-0002']);
		});

		it('filters by category including sub-categories by default', async () => {
			const passives = await categoryId('Passives');
			expect((await list(`?category=${passives}`)).total).toBe(5);
			expect((await list(`?category=${passives}&subcategories=false`)).total).toBe(0);
		});

		it('filters by location including sub-locations', async () => {
			expect((await list(`?location=${await locationId('WS-A')}`)).total).toBe(6);
			expect((await list(`?location=${await locationId('A3')}`)).items[0]?.sku).toBe('IC-0001');
		});

		it('searches and reports low stock', async () => {
			expect(skus(await list('?q=hookup&sort=sku'))).toEqual(['WIR-0001', 'WIR-0002']);
			expect(skus(await list('?lowStock=true&sort=sku'))).toEqual(['RES-0002', 'WIR-0002']);
		});

		it('does not index non-searchable fields', async () => {
			// LM317's datasheet/serial-type fields are searchable:false in the seed; mpn is searchable
			expect(skus(await list('?q=LM317T'))).toEqual(['IC-0001']);
		});

		it.each([
			['?attr.color=red', ['WIR-0001']],
			['?attr.gauge_awg=18', ['WIR-0003']],
			['?attr.gauge_awg[gte]=20&sort=sku', ['WIR-0001', 'WIR-0002']],
			['?attr.stranded=true&attr.color=black&sort=sku', ['WIR-0002', 'WIR-0003']],
			['?attr.tags[contains]=soldering', ['TOL-0002']],
			['?attr.tags=cutting', ['TOL-0001']], // multi-select defaults to contains
			['?attr.resistance[lte]=1000&sort=sku', ['RES-0003']],
			['?attr.package=0603&sort=sku', ['RES-0001', 'RES-0002']],
			['?attr.manufacturer=Texas%20Instruments', ['IC-0001']]
		])('filters attributes %s', async (query, expected) => {
			expect(skus(await list(query))).toEqual(expected);
		});

		it.each([
			['?attr.nope=1', /Unknown field "nope"/],
			['?attr.gauge_awg=abc', /not a number/],
			['?attr.stranded=yes', /true or false/],
			['?attr.color[gte]=1', /only equality/],
			['?attr.Bad-Key=1', /Invalid attribute filter/],
			['?category=999', /Category 999 does not exist/]
		])('rejects %s', async (query, message) => {
			const res = await fx().app.request(`/api/items${query}`);
			expect(res.status).toBe(400);
			expect((await json<ApiErrorBody>(res)).error.message).toMatch(message);
		});

		it('scopes attribute filters to the selected category', async () => {
			const wire = await categoryId('Wire');
			const res = await fx().app.request(`/api/items?category=${wire}&attr.resistance=1`);
			expect(res.status).toBe(400);
		});

		it('validates fixed query parameters', async () => {
			expect((await fx().app.request('/api/items?pageSize=1000')).status).toBe(400);
			expect((await fx().app.request('/api/items?sort=price')).status).toBe(400);
		});
	});

	describe('POST /api/items', () => {
		it('creates an item with a generated SKU, ETag and Location header', async () => {
			const res = await fx().send('POST', '/api/items', {
				categoryId: await categoryId('Wire'),
				name: 'Hookup wire 22AWG blue',
				qtyOnHand: 25_000,
				attributes: { gauge_awg: 22, color: 'blue', stranded: true }
			});
			expect(res.status).toBe(201);
			expect(res.headers.get('etag')).toBe('"1"');
			expect(res.headers.get('location')).toBe('/api/items/WIR-0004');
			expect(await json<ItemWithAvailability>(res)).toMatchObject({
				sku: 'WIR-0004',
				qtyOnHand: 25_000,
				qtyAvailable: 25_000
			});
		});

		it('reports attribute errors per field', async () => {
			const res = await fx().send('POST', '/api/items', {
				categoryId: await categoryId('Resistors'),
				name: 'bad',
				attributes: { resistance: '4k7', tolerance: '2%', colour: 'red' }
			});
			expect(res.status).toBe(400);
			const err = await json<ApiErrorBody>(res);
			expect((err.error.details as ValidationDetails).map((d) => d.path).sort()).toEqual([
				'attributes.colour',
				'attributes.resistance',
				'attributes.tolerance'
			]);
		});

		it.each([
			[
				'missing required attribute',
				async () => ({ categoryId: await categoryId('Resistors'), name: 'x' }),
				400
			],
			[
				'fractional quantity',
				async () => ({ categoryId: await categoryId('Tools'), name: 'x', qtyOnHand: 1.5 }),
				400
			],
			['unknown category', async () => ({ categoryId: 999, name: 'x' }), 422],
			[
				'unknown location',
				async () => ({ categoryId: await categoryId('Tools'), name: 'x', locationId: 999 }),
				422
			],
			[
				'duplicate SKU',
				async () => ({ sku: 'TOL-0001', categoryId: await categoryId('Tools'), name: 'x' }),
				409
			],
			[
				'duplicate barcode',
				async () => ({
					categoryId: await categoryId('Tools'),
					name: 'x',
					barcode: '0123456789012'
				}),
				409
			],
			[
				'no SKU prefix',
				async () => ({ categoryId: await categoryId('Electronics'), name: 'x' }),
				422
			]
		])('rejects %s', async (_, body, status) => {
			expect((await fx().send('POST', '/api/items', await body())).status).toBe(status);
		});
	});

	describe('GET/PATCH /api/items/:sku', () => {
		it('returns an item with its ETag, 404 for unknown SKUs', async () => {
			const res = await fx().app.request('/api/items/WIR-0001');
			expect(res.headers.get('etag')).toBe('"1"');
			expect(await json<ItemWithAvailability>(res)).toMatchObject({
				qtyOnHand: 37_500,
				qtyReserved: 1_500,
				qtyAvailable: 36_000
			});
			expect((await fx().app.request('/api/items/NOPE')).status).toBe(404);
		});

		it('merges attributes and bumps the version', async () => {
			const res = await fx().send('PATCH', '/api/items/WIR-0001', {
				name: 'Hookup wire 22AWG red (spool)',
				attributes: { insulation: 'Silicone', stranded: null }
			});
			expect(res.status).toBe(200);
			expect(res.headers.get('etag')).toBe('"2"');
			expect((await json<ItemWithAvailability>(res)).attributes).toEqual({
				gauge_awg: 22,
				color: 'red',
				stranded: null,
				insulation: 'Silicone'
			});
		});

		it('honours If-Match', async () => {
			const ok = await fx().send(
				'PATCH',
				'/api/items/TOL-0001',
				{ name: 'a' },
				{ 'if-match': '"1"' }
			);
			expect(ok.status).toBe(200);
			const stale = await fx().send(
				'PATCH',
				'/api/items/TOL-0001',
				{ name: 'b' },
				{ 'if-match': 'W/"1"' }
			);
			expect(stale.status).toBe(412);
			expect((await json<ApiErrorBody>(stale)).error).toMatchObject({
				code: 'version_conflict',
				details: { expectedVersion: 1, currentVersion: 2 }
			});
			const bad = await fx().send(
				'PATCH',
				'/api/items/TOL-0001',
				{ name: 'c' },
				{ 'if-match': 'abc' }
			);
			expect(bad.status).toBe(400);
		});

		it.each([
			[{ sku: 'NEW-1' }, 400],
			[{ qtyOnHand: 5 }, 400],
			[{}, 400],
			[{ attributes: { color: 'purple' } }, 400],
			[{ categoryId: 1 }, 422] // Wire (length) → Electronics (count)
		])('rejects PATCH %j', async (body, status) => {
			expect((await fx().send('PATCH', '/api/items/WIR-0001', body)).status).toBe(status);
		});
	});

	describe('archive and delete', () => {
		it('archives by default and restores', async () => {
			const res = await fx().send('DELETE', '/api/items/TOL-0001');
			expect(res.status).toBe(200);
			expect((await json<ItemWithAvailability>(res)).archivedAt).not.toBeNull();
			expect((await list('?q=stripper')).total).toBe(0);
			expect((await list('?q=stripper&includeArchived=true')).total).toBe(1);
			const restored = await fx().send('POST', '/api/items/TOL-0001/restore');
			expect((await json<ItemWithAvailability>(restored)).archivedAt).toBeNull();
		});

		it('permanently deletes only items without history', async () => {
			expect((await fx().send('DELETE', '/api/items/TOL-0001?permanent=true')).status).toBe(409);
			await fx().send('POST', '/api/items', {
				sku: 'TMP-1',
				categoryId: await categoryId('Tools'),
				name: 'tmp'
			});
			expect((await fx().send('DELETE', '/api/items/TMP-1?permanent=true')).status).toBe(204);
			expect((await fx().app.request('/api/items/TMP-1')).status).toBe(404);
		});
	});

	describe('stock', () => {
		it('records movements and lists them newest first', async () => {
			const res = await fx().send('POST', '/api/items/RES-0001/movements', {
				delta: 50,
				reason: 'receive',
				note: 'order #42'
			});
			expect(res.status).toBe(201);
			expect(await json<{ qtyOnHand: number }>(res)).toMatchObject({ qtyOnHand: 480 });
			const movements = await json<StockMovement[]>(
				await fx().app.request('/api/items/RES-0001/movements?limit=2')
			);
			expect(movements.map((m) => [m.delta, m.reason])).toEqual([
				[50, 'receive'],
				[-20, 'consume']
			]);
		});

		it.each([
			[{ delta: -10_000, reason: 'consume' }, 409, 'insufficient_stock'],
			[{ delta: 5, reason: 'consume' }, 422, 'invalid_operation'],
			[{ delta: 0, reason: 'adjust' }, 400, 'validation'],
			[{ delta: 1, reason: 'reserve_consume' }, 400, 'validation'],
			[{ delta: 1, reason: 'adjust', projectId: 999 }, 422, 'invalid_operation']
		])('rejects movement %j', async (body, status, code) => {
			const res = await fx().send('POST', '/api/items/RES-0001/movements', body);
			expect(res.status).toBe(status);
			expect((await json<ApiErrorBody>(res)).error.code).toBe(code);
		});

		it('returns 404 for movements on unknown items', async () => {
			expect(
				(await fx().send('POST', '/api/items/NOPE/movements', { delta: 1, reason: 'adjust' }))
					.status
			).toBe(404);
			expect((await fx().app.request('/api/items/NOPE/movements')).status).toBe(404);
		});

		it('records counts', async () => {
			const res = await fx().send('POST', '/api/items/WIR-0002/count', {
				countedQty: 4_000,
				note: 'stocktake'
			});
			expect(await json<unknown>(res)).toMatchObject({
				qtyOnHand: 4_000,
				movement: { delta: -200, reason: 'count' }
			});
		});

		it('lists reservations of an item', async () => {
			const res = await fx().app.request('/api/items/WIR-0001/reservations');
			expect(await json<unknown[]>(res)).toHaveLength(1);
		});
	});

	describe('GET /api/lookup', () => {
		async function lookup(code: string) {
			return fx().app.request(`/api/lookup?code=${encodeURIComponent(code)}`);
		}

		it.each([
			['IC-0001', 'item'],
			['0123456789012', 'item'],
			['A1', 'location'],
			['https://inventory.example.com/i/WIR-0001', 'item'],
			['/l/WS-TB', 'location'],
			['https://inventory.example.com/p/1', 'project']
		])('resolves %s to a %s', async (code, type) => {
			const res = await lookup(code);
			expect(res.status).toBe(200);
			expect((await json<LookupResult>(res)).type).toBe(type);
		});

		it('returns 404 for unknown codes and 400 for missing ones', async () => {
			expect((await lookup('4006381333931')).status).toBe(404);
			expect((await lookup('https://x.example/i/NOPE')).status).toBe(404);
			expect((await fx().app.request('/api/lookup')).status).toBe(400);
		});
	});
});

describe('locations API', () => {
	const fx = useApi();

	it('supports CRUD with validation', async () => {
		const created = await fx().send('POST', '/api/locations', { name: 'Shelf B', code: 'WS-B' });
		expect(created.status).toBe(201);
		const { id } = await json<{ id: number }>(created);
		const child = await fx().send('POST', '/api/locations', {
			name: 'Bin B1',
			code: 'B1',
			parentId: id
		});
		const { id: childId } = await json<{ id: number }>(child);

		expect((await fx().send('POST', '/api/locations', { name: 'Dup', code: 'WS-B' })).status).toBe(
			409
		);
		expect(
			(await fx().send('POST', '/api/locations', { name: 'Bad', code: 'has space' })).status
		).toBe(400);
		expect((await fx().send('PATCH', `/api/locations/${id}`, { parentId: childId })).status).toBe(
			422
		);

		const renamed = await fx().send('PATCH', `/api/locations/${childId}`, { name: 'Bin B-1' });
		expect((await json<{ name: string }>(renamed)).name).toBe('Bin B-1');
		expect(await json<unknown[]>(await fx().app.request('/api/locations'))).toHaveLength(2);

		expect((await fx().send('DELETE', `/api/locations/${id}`)).status).toBe(409);
		expect((await fx().send('DELETE', `/api/locations/${childId}`)).status).toBe(204);
		expect((await fx().send('DELETE', `/api/locations/${id}`)).status).toBe(204);
		expect((await fx().app.request(`/api/locations/${id}`)).status).toBe(404);
	});
});
