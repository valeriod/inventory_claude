import type { BomLine, Report } from '@inventory/shared';
import { describe, expect, it } from 'vitest';
import { reportToCsv } from './reports/csv.ts';
import { json, useApi } from './test-helpers.ts';

describe('reports API', () => {
	const api = useApi({ seed: true });

	it('builds the inventory report with filters, in display units', async () => {
		const all = await json<Report>(await api().send('GET', '/api/reports/inventory'));
		expect(all.kind).toBe('inventory');
		expect(all.rows.length).toBeGreaterThan(5);
		const wire = all.rows.find((r) => r.name === 'Hookup wire 22AWG red');
		expect(wire).toMatchObject({ onHand: 37.5, reserved: 1.5, available: 36, unit: 'm' });

		const categories = await json<{ id: number; name: string }[]>(
			await api().send('GET', '/api/categories')
		);
		const wireCat = categories.find((c) => c.name === 'Wire')!;
		const filtered = await json<Report>(
			await api().send('GET', `/api/reports/inventory?category=${wireCat.id}`)
		);
		expect(filtered.filters[0]).toContain('Wire');
		expect(filtered.rows.every((r) => String(r.category).includes('Wire'))).toBe(true);
	});

	it('lists low stock with the shortfall to the minimum', async () => {
		const report = await json<Report>(await api().send('GET', '/api/reports/low-stock'));
		const black = report.rows.find((r) => r.name === 'Hookup wire 22AWG black');
		expect(black).toMatchObject({ available: 4.2, unit: 'm' });
		expect(Number(black!.toMin)).toBeGreaterThan(0);
	});

	it('builds a project bill of materials with what to buy', async () => {
		const projects = await json<{ id: number }[]>(await api().send('GET', '/api/projects'));
		const id = projects[0]!.id;
		const bom = await json<BomLine[]>(await api().send('GET', `/api/projects/${id}/bom`));
		const caps = bom.find((l) => l.item.name.startsWith('470µF'));
		expect(caps).toMatchObject({ qtyNeeded: 20, qtyReserved: 0, qtyCanReserve: 12, qtyToBuy: 8 });

		const report = await json<Report>(await api().send('GET', `/api/reports/project/${id}`));
		expect(report.title).toBe('Project: Bench power supply');
		expect(report.rows.find((r) => r.sku === caps!.sku)).toMatchObject({ toBuy: 8 });

		expect(await json(await api().send('POST', `/api/projects/${id}/reserve-needed`))).toEqual({
			reserved: 1
		});
		const after = await json<BomLine[]>(await api().send('GET', `/api/projects/${id}/bom`));
		expect(after.find((l) => l.sku === caps!.sku)).toMatchObject({ qtyReserved: 12, qtyToBuy: 8 });
	});

	it('sets and removes needed quantities', async () => {
		const p = await json<{ id: number }>(
			await api().send('POST', '/api/projects', { name: 'Clock', status: 'active' })
		);
		const put = await api().send('PUT', `/api/projects/${p.id}/parts/RES-0001`, { qtyNeeded: 3 });
		expect(await json(put)).toMatchObject({ sku: 'RES-0001', qtyNeeded: 3 });
		expect(
			(await api().send('PUT', `/api/projects/${p.id}/parts/RES-0001`, { qtyNeeded: 0 })).status
		).toBe(400);
		expect(
			(await api().send('PUT', `/api/projects/${p.id}/parts/NOPE`, { qtyNeeded: 1 })).status
		).toBe(404);
		expect((await api().send('DELETE', `/api/projects/${p.id}/parts/RES-0001`)).status).toBe(204);
		expect(await json(await api().send('GET', `/api/projects/${p.id}/bom`))).toEqual([]);
	});

	it('reports movements in a time range', async () => {
		const report = await json<Report>(
			await api().send('GET', '/api/reports/movements?reason=count')
		);
		expect(report.rows).toHaveLength(1);
		expect(report.rows[0]).toMatchObject({ reason: 'Counted', change: -2, unit: 'pcs' });

		const future = encodeURIComponent('2999-01-01T00:00:00Z');
		const none = await json<Report>(
			await api().send('GET', `/api/reports/movements?from=${future}`)
		);
		expect(none.rows).toEqual([]);
		const bad = await api().send(
			'GET',
			`/api/reports/movements?from=${future}&to=${encodeURIComponent('2000-01-01T00:00:00Z')}`
		);
		expect(bad.status).toBe(400);
	});

	it('exports CSV and PDF', async () => {
		const csv = await api().send('GET', '/api/reports/inventory?format=csv');
		expect(csv.headers.get('content-type')).toContain('text/csv');
		expect(csv.headers.get('content-disposition')).toMatch(
			/attachment; filename="inventory-\d{4}-\d{2}-\d{2}\.csv"/
		);
		const text = await csv.text();
		expect(text.split('\r\n')[0]).toBe(
			'SKU,Name,Category,Location,On hand,Reserved,Available,Min,Unit'
		);

		const pdf = await api().send('GET', '/api/reports/movements?format=pdf&tz=Europe/Rome');
		expect(pdf.headers.get('content-type')).toBe('application/pdf');
		expect(
			Buffer.from(await pdf.arrayBuffer())
				.subarray(0, 5)
				.toString()
		).toBe('%PDF-');
		expect((await api().send('GET', '/api/reports/inventory?tz=Mars/Base')).status).toBe(400);
	});
});

describe('reportToCsv', () => {
	it('quotes, escapes formulas in text and adds a BOM', () => {
		const csv = reportToCsv({
			kind: 'inventory',
			title: 't',
			filters: [],
			generatedAt: '',
			summary: [],
			truncated: false,
			columns: [
				{ key: 'a', label: 'A', type: 'text' },
				{ key: 'n', label: 'N', type: 'number' }
			],
			rows: [
				{ a: 'say "hi", ok', n: -3 },
				{ a: '=SUM(A1)', n: null },
				{ a: '10kΩ', n: 1.5 }
			]
		});
		expect(csv).toBe('﻿A,N\r\n"say ""hi"", ok",-3\r\n\'=SUM(A1),\r\n10kΩ,1.5\r\n');
	});
});
