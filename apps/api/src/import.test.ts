import type { ImportResult } from '@inventory/shared';
import { describe, expect, it } from 'vitest';
import { json, useApi } from './test-helpers.ts';

const post = (api: ReturnType<ReturnType<typeof useApi>>, csv: string, query = '') =>
	api.app.request(`/api/import/items${query}`, {
		method: 'POST',
		headers: { 'content-type': 'text/csv' },
		body: csv
	});

describe('items CSV import and export', () => {
	const api = useApi({ seed: true });

	async function categoryId(name: string) {
		const list = await json<{ id: number; name: string }[]>(
			await api().send('GET', '/api/categories')
		);
		return list.find((c) => c.name === name)!.id;
	}

	it('checks a file without writing, then imports it', async () => {
		const resistors = await categoryId('Resistors');
		const csv = [
			'Name,Resistance,Tolerance,Package,On hand,Location,Power (W)',
			'1kΩ 1% 0603,1k,1%,0603,100,A1,0.1',
			'2.2kΩ bad,2k2,7%,0603,50,A1,',
			'No resistance,,1%,0603,,,'
		].join('\n');
		const dry = await json<ImportResult>(await post(api(), csv, `?category=${resistors}`));
		expect(dry.committed).toBe(false);
		expect(dry.summary).toEqual({ create: 1, update: 0, unchanged: 0, error: 2 });
		expect(dry.rows[1]!.errors.join(' ')).toMatch(/Tolerance/);
		expect(dry.rows[2]!.errors.join(' ')).toMatch(/Resistance/);

		const refused = await post(api(), csv, `?category=${resistors}&commit=true`);
		expect(refused.status).toBe(422);
		expect((await json<ImportResult>(refused)).committed).toBe(false);

		const good = csv.split('\n').slice(0, 2).join('\n');
		const done = await json<ImportResult>(
			await post(api(), good, `?category=${resistors}&commit=true`)
		);
		expect(done.committed).toBe(true);
		const sku = done.rows[0]!.sku!;
		expect(sku).toMatch(/^RES-\d{4}$/);
		const item = await json<{ qtyOnHand: number; attributes: Record<string, unknown> }>(
			await api().send('GET', `/api/items/${sku}`)
		);
		expect(item).toMatchObject({
			qtyOnHand: 100,
			attributes: { resistance: 1000, tolerance: '1%' }
		});
	});

	it('round-trips the export: unchanged rows, updates, and opt-in stock counts', async () => {
		const exported = await (await api().send('GET', '/api/export?format=csv')).text();
		const again = await json<ImportResult>(await post(api(), exported));
		expect(again.summary.error).toBe(0);
		expect(again.summary.create).toBe(0);
		expect(again.summary.update).toBe(0);

		const lines = exported
			.replace(/^\uFEFF/, '')
			.trim()
			.split('\r\n');
		const header = lines[0]!;
		const wire = lines.find((l) => l.startsWith('WIR-0001,'))!;
		const edited = wire
			.replace('Hookup wire 22AWG red', 'Hookup wire 22AWG red (spool)')
			.replace(',37.5,m,', ',30,m,');
		const withoutStock = await json<ImportResult>(
			await post(api(), `${header}\n${edited}`, '?commit=true')
		);
		expect(withoutStock.rows[0]).toMatchObject({ action: 'update' });
		expect(withoutStock.rows[0]!.warnings.join(' ')).toMatch(/On hand differs/);

		const withStock = await json<ImportResult>(
			await post(api(), `${header}\n${edited}`, '?commit=true&updateStock=true')
		);
		expect(withStock.committed).toBe(true);
		const item = await json<{ name: string; qtyOnHand: number }>(
			await api().send('GET', '/api/items/WIR-0001')
		);
		expect(item).toEqual(
			expect.objectContaining({ name: 'Hookup wire 22AWG red (spool)', qtyOnHand: 30_000 })
		);
	});

	it('reports unknown columns, categories, locations and duplicates', async () => {
		const csv = [
			'SKU,Name,Category,Location,Colour of moon',
			'X-1,A,Nope,A1,',
			'X-1,B,Wire,ZZ,'
		].join('\n');
		const result = await json<ImportResult>(await post(api(), csv));
		expect(result.unknownColumns).toEqual(['Colour of moon']);
		expect(result.rows[0]!.errors).toContain('Unknown category "Nope"');
		expect(result.rows[1]!.errors.join(' ')).toMatch(/also appears on line 2/);
		expect(result.rows[1]!.errors.join(' ')).toMatch(/Unknown location code "ZZ"/);
		expect((await post(api(), 'just a header')).status).toBe(400);
	});

	it('exports everything as JSON and offers an import template', async () => {
		const res = await api().send('GET', '/api/export');
		expect(res.headers.get('content-disposition')).toMatch(/inventory-\d{4}-\d{2}-\d{2}\.json/);
		const dump = await json<{ format: string; tables: { items: unknown[] } }>(res);
		expect(dump.format).toBe('inventory-dump');
		expect(dump.tables.items.length).toBeGreaterThan(5);

		const template = await (
			await api().send('GET', `/api/import/template?category=${await categoryId('Resistors')}`)
		).text();
		expect(template).toContain('Resistance');
		const system = await json<{ database: string }>(await api().send('GET', '/api/system'));
		expect(['sqlite', 'postgres']).toContain(system.database);
	});
});
