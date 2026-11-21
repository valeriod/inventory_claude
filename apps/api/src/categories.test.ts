import { createRepositories } from '@inventory/db';
import { createTestDatabase, type TestDatabase } from '@inventory/db/testing';
import type { ApiErrorBody, CategoryWithFields } from '@inventory/shared';
import type { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';

let db: TestDatabase;
let app: Hono;

beforeEach(async () => {
	db = await createTestDatabase();
	app = createApp({ conn: db });
});
afterEach(async () => {
	await db.cleanup();
});

function send(method: string, path: string, body?: unknown) {
	return app.request(path, {
		method,
		headers: { 'content-type': 'application/json' },
		body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
	});
}

async function json<T>(res: Response): Promise<T> {
	return (await res.json()) as T;
}

const electronics = {
	name: 'Electronics',
	unitKind: 'count',
	displayUnit: 'pcs',
	fieldDefs: [{ key: 'manufacturer', label: 'Manufacturer', type: 'text' }]
};

async function createTree() {
	const parent = await json<CategoryWithFields>(await send('POST', '/api/categories', electronics));
	const child = await json<CategoryWithFields>(
		await send('POST', '/api/categories', {
			name: 'Resistors',
			parentId: parent.id,
			skuPrefix: 'RES-',
			unitKind: 'count',
			displayUnit: 'pcs',
			fieldDefs: [
				{ key: 'resistance', label: 'Resistance', type: 'quantity', unit: 'Ω', required: true }
			]
		})
	);
	return { parent, child };
}

describe('GET /api/units', () => {
	it('returns the unit table', async () => {
		const units = await json<Record<string, { base: string }>>(await app.request('/api/units'));
		expect(units['length']?.base).toBe('mm');
		expect(Object.keys(units)).toEqual(['count', 'length', 'mass', 'volume']);
	});
});

describe('/api/categories', () => {
	it('creates a category with defaults applied and resolved fields', async () => {
		const res = await send('POST', '/api/categories', electronics);
		expect(res.status).toBe(201);
		const body = await json<CategoryWithFields>(res);
		expect(body).toMatchObject({ name: 'Electronics', parentId: null, skuPrefix: null });
		expect(body.fieldDefs[0]).toMatchObject({
			key: 'manufacturer',
			required: false,
			searchable: true
		});
		expect(body.resolvedFieldDefs).toHaveLength(1);
	});

	it('lists categories with inherited fields', async () => {
		const { child } = await createTree();
		expect(child.resolvedFieldDefs.map((d) => [d.key, d.inherited])).toEqual([
			['manufacturer', true],
			['resistance', false]
		]);
		const list = await json<CategoryWithFields[]>(await app.request('/api/categories'));
		expect(list.map((c) => c.name)).toEqual(['Electronics', 'Resistors']);
	});

	it('gets one category, 404 for unknown and 400 for malformed ids', async () => {
		const { child } = await createTree();
		expect(
			(await json<CategoryWithFields>(await app.request(`/api/categories/${child.id}`))).name
		).toBe('Resistors');
		const missing = await app.request('/api/categories/999');
		expect(missing.status).toBe(404);
		expect((await json<ApiErrorBody>(missing)).error.code).toBe('not_found');
		expect((await app.request('/api/categories/abc')).status).toBe(400);
		expect((await app.request('/api/categories/0')).status).toBe(400);
	});

	it.each([
		['missing name', { unitKind: 'count', displayUnit: 'pcs' }, 'name'],
		['bad unit for kind', { name: 'W', unitKind: 'length', displayUnit: 'pcs' }, 'displayUnit'],
		['unknown property', { ...electronics, colour: 'red' }, ''],
		[
			'bad field key',
			{ ...electronics, fieldDefs: [{ key: 'Bad Key', label: 'x', type: 'text' }] },
			'fieldDefs.0.key'
		],
		['bad SKU prefix', { ...electronics, skuPrefix: 'a b' }, 'skuPrefix']
	])('rejects %s with 400', async (_, body, path) => {
		const res = await send('POST', '/api/categories', body);
		expect(res.status).toBe(400);
		const err = await json<ApiErrorBody>(res);
		expect(err.error.code).toBe('validation');
		expect((err.error.details as { path: string }[]).map((d) => d.path)).toContain(path);
	});

	it('rejects malformed JSON with 400', async () => {
		const res = await send('POST', '/api/categories', '{not json');
		expect(res.status).toBe(400);
		expect((await json<ApiErrorBody>(res)).error.code).toBe('bad_request');
	});

	it('returns 409 for duplicate names and inherited key conflicts', async () => {
		const { parent } = await createTree();
		expect((await send('POST', '/api/categories', electronics)).status).toBe(409);
		const res = await send('POST', '/api/categories', {
			name: 'ICs',
			parentId: parent.id,
			unitKind: 'count',
			displayUnit: 'pcs',
			fieldDefs: [{ key: 'manufacturer', label: 'Maker', type: 'text' }]
		});
		expect(res.status).toBe(409);
		expect((await json<ApiErrorBody>(res)).error.message).toMatch(/manufacturer/);
	});

	it('updates a category', async () => {
		const { child } = await createTree();
		const res = await send('PATCH', `/api/categories/${child.id}`, { name: 'Resistors (SMD)' });
		expect(res.status).toBe(200);
		expect((await json<CategoryWithFields>(res)).name).toBe('Resistors (SMD)');
		expect((await send('PATCH', `/api/categories/${child.id}`, {})).status).toBe(400);
		expect((await send('PATCH', `/api/categories/${child.id}`, { displayUnit: 'm' })).status).toBe(
			422
		);
		expect(
			(await send('PATCH', `/api/categories/${child.id}`, { parentId: child.id })).status
		).toBe(422);
	});

	it('returns 409 with violations when a field change would invalidate items', async () => {
		const { child } = await createTree();
		await createRepositories(db).items.create({
			categoryId: child.id,
			name: '10k',
			attributes: { resistance: 10_000 }
		});
		const res = await send('PATCH', `/api/categories/${child.id}`, {
			fieldDefs: [{ key: 'resistance', label: 'R', type: 'text', required: true }]
		});
		expect(res.status).toBe(409);
		const err = await json<ApiErrorBody>(res);
		expect(err.error.code).toBe('field_change_conflict');
		expect(err.error.details).toEqual([{ sku: 'RES-0001', key: 'resistance' }]);
	});

	it('renames a field', async () => {
		const { parent } = await createTree();
		const res = await send('POST', `/api/categories/${parent.id}/fields/manufacturer/rename`, {
			newKey: 'brand'
		});
		expect(res.status).toBe(200);
		expect((await json<CategoryWithFields>(res)).fieldDefs.map((d) => d.key)).toEqual(['brand']);
		const bad = await send('POST', `/api/categories/${parent.id}/fields/nope/rename`, {
			newKey: 'x'
		});
		expect(bad.status).toBe(422);
	});

	it('deletes empty categories only', async () => {
		const { parent, child } = await createTree();
		expect((await send('DELETE', `/api/categories/${parent.id}`)).status).toBe(409);
		expect((await send('DELETE', `/api/categories/${child.id}`)).status).toBe(204);
		expect((await send('DELETE', `/api/categories/${parent.id}`)).status).toBe(204);
		expect((await send('DELETE', `/api/categories/${parent.id}`)).status).toBe(404);
	});
});
