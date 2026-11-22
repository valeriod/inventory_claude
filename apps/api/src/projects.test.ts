import type { PickLine, ProjectSummary, Reservation } from '@inventory/shared';
import { describe, expect, it } from 'vitest';
import { json, useApi } from './test-helpers.ts';

describe('projects API', () => {
	const api = useApi({ seed: true });

	async function newProject(name = 'Clock', status = 'active') {
		const res = await api().send('POST', '/api/projects', { name, status });
		expect(res.status).toBe(201);
		return json<ProjectSummary>(res);
	}

	it('creates, lists, filters, updates and deletes projects', async () => {
		const p = await newProject();
		expect(p).toMatchObject({ name: 'Clock', status: 'active', openLines: 0 });

		const active = await json<ProjectSummary[]>(
			await api().send('GET', '/api/projects?status=active')
		);
		expect(active.map((x) => x.name)).toContain('Clock');
		const done = await json<ProjectSummary[]>(
			await api().send('GET', '/api/projects?status=completed')
		);
		expect(done.map((x) => x.name)).not.toContain('Clock');
		expect((await api().send('GET', '/api/projects?status=nope')).status).toBe(400);

		const patched = await api().send('PATCH', `/api/projects/${p.id}`, { name: 'Wall clock' });
		expect(await json<ProjectSummary>(patched)).toMatchObject({ name: 'Wall clock' });
		expect((await api().send('PATCH', `/api/projects/${p.id}`, {})).status).toBe(400);

		expect((await api().send('DELETE', `/api/projects/${p.id}`)).status).toBe(204);
		expect((await api().send('GET', `/api/projects/${p.id}`)).status).toBe(404);
	});

	it('reserves parts, builds the pick list and refuses over-reservation', async () => {
		const p = await newProject();
		const res = await api().send('POST', `/api/projects/${p.id}/reservations`, {
			sku: 'RES-0002',
			qty: 30
		});
		expect(res.status).toBe(201);
		const lines = await json<PickLine[]>(
			await api().send('GET', `/api/projects/${p.id}/reservations`)
		);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({ sku: 'RES-0002', qtyReserved: 30, shortBy: 0 });
		expect(lines[0]!.item.name).toContain('4.7k');

		const over = await api().send('POST', `/api/projects/${p.id}/reservations`, {
			sku: 'RES-0002',
			qty: 1000
		});
		expect(over.status).toBe(409);
		expect((await json<{ error: { code: string } }>(over)).error.code).toBe('insufficient_stock');

		const unknown = await api().send('POST', `/api/projects/${p.id}/reservations`, {
			sku: 'NOPE-1',
			qty: 1
		});
		expect(unknown.status).toBe(404);
	});

	it('changes, partly consumes, consumes and releases reservations', async () => {
		const p = await newProject();
		const r = await json<Reservation>(
			await api().send('POST', `/api/projects/${p.id}/reservations`, { sku: 'RES-0001', qty: 10 })
		);
		const send = (body: unknown) => api().send('PATCH', `/api/reservations/${r.id}`, body);

		expect(await json<Reservation>(await send({ qty: 8 }))).toMatchObject({ qtyReserved: 8 });
		expect(await json<Reservation>(await send({ status: 'consumed', qty: 3 }))).toMatchObject({
			status: 'reserved',
			qtyReserved: 5
		});
		expect((await send({ status: 'consumed', qty: 6 })).status).toBe(422);
		expect(await json<Reservation>(await send({ status: 'released' }))).toMatchObject({
			status: 'released'
		});
		expect((await send({ status: 'released' })).status).toBe(422);
		expect((await send({ status: 'bogus' })).status).toBe(400);

		const movements = await json<{ reason: string; delta: number; projectId: number }[]>(
			await api().send('GET', '/api/items/RES-0001/movements')
		);
		expect(movements[0]).toMatchObject({ reason: 'reserve_consume', delta: -3, projectId: p.id });
	});

	it('consumes or releases all open lines and guards closing the project', async () => {
		const p = await newProject();
		for (const sku of ['RES-0001', 'CAP-0001']) {
			await api().send('POST', `/api/projects/${p.id}/reservations`, { sku, qty: 2 });
		}
		const close = await api().send('PATCH', `/api/projects/${p.id}`, { status: 'completed' });
		expect(close.status).toBe(422);

		const consumed = await api().send('POST', `/api/projects/${p.id}/consume-all`, {
			note: 'built'
		});
		expect(await json(consumed)).toEqual({ consumed: 2 });
		const summary = await json<ProjectSummary>(await api().send('GET', `/api/projects/${p.id}`));
		expect(summary).toMatchObject({ openLines: 0, consumedLines: 2 });
		expect(
			(await api().send('PATCH', `/api/projects/${p.id}`, { status: 'completed' })).status
		).toBe(200);

		// Closed projects cannot reserve.
		const late = await api().send('POST', `/api/projects/${p.id}/reservations`, {
			sku: 'RES-0001',
			qty: 1
		});
		expect(late.status).toBe(422);

		const q = await newProject('Other');
		await api().send('POST', `/api/projects/${q.id}/reservations`, { sku: 'RES-0001', qty: 1 });
		expect(await json(await api().send('POST', `/api/projects/${q.id}/release-all`))).toEqual({
			released: 1
		});
	});

	it('lists item reservations with project names', async () => {
		const p = await newProject('Amp');
		await api().send('POST', `/api/projects/${p.id}/reservations`, { sku: 'RES-0001', qty: 1 });
		const list = await json<{ project: { name: string } }[]>(
			await api().send('GET', '/api/items/RES-0001/reservations')
		);
		expect(list.map((r) => r.project.name)).toContain('Amp');
	});

	it('resolves project QR labels', async () => {
		const p = await newProject('Synth');
		const res = await api().send(
			'GET',
			`/api/lookup?code=${encodeURIComponent(`https://x/p/${p.id}`)}`
		);
		expect(await json(res)).toMatchObject({ type: 'project', project: { name: 'Synth' } });
	});
});
