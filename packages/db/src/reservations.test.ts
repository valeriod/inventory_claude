import { describe, expect, it } from 'vitest';
import { InsufficientStockError, InvalidOperationError } from './errors.ts';
import { createCountCategory, useTestDatabase } from './test-helpers.ts';

describe('ReservationRepository', () => {
	const fx = useTestDatabase();

	async function setup(qty = 10) {
		const { repos } = fx();
		const cat = await createCountCategory(repos);
		const item = await repos.items.create({ categoryId: cat.id, name: 'Part', qtyOnHand: qty });
		const project = await repos.projects.create({ name: 'Amp', status: 'active' });
		const other = await repos.projects.create({ name: 'Clock' });
		return { repos, sku: item.sku, project, other };
	}

	it('reserves within availability and reflects it on the item', async () => {
		const { repos, sku, project } = await setup();
		const r = await repos.reservations.reserve({ projectId: project.id, sku, qty: 4, note: 'v1' });
		expect(r).toMatchObject({ projectId: project.id, sku, qtyReserved: 4, status: 'reserved' });
		expect(await repos.reservations.availability(sku)).toEqual({
			qtyOnHand: 10,
			qtyReserved: 4,
			qtyAvailable: 6
		});
		expect((await repos.items.get(sku)).qtyAvailable).toBe(6);
	});

	it('merges repeated reservations for the same project and SKU', async () => {
		const { repos, sku, project } = await setup();
		const first = await repos.reservations.reserve({ projectId: project.id, sku, qty: 2 });
		const second = await repos.reservations.reserve({ projectId: project.id, sku, qty: 3 });
		expect(second.id).toBe(first.id);
		expect(second.qtyReserved).toBe(5);
		expect(await repos.reservations.listByProject(project.id)).toHaveLength(1);
	});

	it('refuses to over-reserve across projects', async () => {
		const { repos, sku, project, other } = await setup();
		await repos.reservations.reserve({ projectId: project.id, sku, qty: 8 });
		const err = await repos.reservations
			.reserve({ projectId: other.id, sku, qty: 3 })
			.catch((e) => e);
		expect(err).toBeInstanceOf(InsufficientStockError);
		expect(err).toMatchObject({ requested: 3, available: 2 });
	});

	it('refuses reservations for closed projects and bad quantities', async () => {
		const { repos, sku, project } = await setup();
		await repos.projects.update(project.id, { status: 'completed' });
		await expect(
			repos.reservations.reserve({ projectId: project.id, sku, qty: 1 })
		).rejects.toBeInstanceOf(InvalidOperationError);
		const open = await repos.projects.create({ name: 'Open' });
		await expect(
			repos.reservations.reserve({ projectId: open.id, sku, qty: 0 })
		).rejects.toBeInstanceOf(InvalidOperationError);
	});

	it('changes quantity, counting only other reservations against availability', async () => {
		const { repos, sku, project, other } = await setup();
		const r = await repos.reservations.reserve({ projectId: project.id, sku, qty: 4 });
		await repos.reservations.reserve({ projectId: other.id, sku, qty: 4 });
		expect((await repos.reservations.updateQty(r.id, 6)).qtyReserved).toBe(6);
		await expect(repos.reservations.updateQty(r.id, 7)).rejects.toBeInstanceOf(
			InsufficientStockError
		);
	});

	it('releases reserved stock back to available', async () => {
		const { repos, sku, project } = await setup();
		const r = await repos.reservations.reserve({ projectId: project.id, sku, qty: 4 });
		expect((await repos.reservations.release(r.id)).status).toBe('released');
		expect((await repos.reservations.availability(sku)).qtyAvailable).toBe(10);
		await expect(repos.reservations.release(r.id)).rejects.toBeInstanceOf(InvalidOperationError);
	});

	it('consumes a reservation into a stock movement', async () => {
		const { repos, sku, project } = await setup();
		const r = await repos.reservations.reserve({ projectId: project.id, sku, qty: 4 });
		const consumed = await repos.reservations.consume(r.id, { note: 'built' });
		expect(consumed.status).toBe('consumed');
		expect(await repos.reservations.availability(sku)).toEqual({
			qtyOnHand: 6,
			qtyReserved: 0,
			qtyAvailable: 6
		});
		const [movement] = await repos.stock.movements({ projectId: project.id });
		expect(movement).toMatchObject({
			sku,
			delta: -4,
			reason: 'reserve_consume',
			reservationId: r.id,
			note: 'built'
		});
		await expect(repos.reservations.consume(r.id)).rejects.toBeInstanceOf(InvalidOperationError);
	});

	it('cannot consume more than is on hand and leaves the reservation open', async () => {
		const { repos, sku, project } = await setup();
		const r = await repos.reservations.reserve({ projectId: project.id, sku, qty: 8 });
		await repos.stock.adjust({ sku, delta: -5, reason: 'consume' }); // ad-hoc use creates a shortage
		expect((await repos.items.get(sku)).qtyAvailable).toBe(-3);
		await expect(repos.reservations.consume(r.id)).rejects.toBeInstanceOf(InsufficientStockError);
		expect((await repos.reservations.get(r.id)).status).toBe('reserved');
	});

	it('handles concurrent reservations without over-committing', async () => {
		const { repos, sku, project, other } = await setup(10);
		const results = await Promise.allSettled(
			Array.from({ length: 12 }, (_, i) =>
				repos.reservations.reserve({ projectId: i % 2 ? project.id : other.id, sku, qty: 1 })
			)
		);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
		expect(await repos.reservations.availability(sku)).toMatchObject({
			qtyReserved: 10,
			qtyAvailable: 0
		});
	});

	it('deleting a project removes its reservations but keeps movement history', async () => {
		const { repos, sku, project } = await setup();
		const r = await repos.reservations.reserve({ projectId: project.id, sku, qty: 2 });
		await repos.reservations.consume(r.id);
		await repos.reservations.reserve({ projectId: project.id, sku, qty: 1 });
		await repos.projects.delete(project.id);
		expect(await repos.reservations.listBySku(sku)).toEqual([]);
		const [movement] = await repos.stock.movements({ sku, reasons: ['reserve_consume'] });
		expect(movement).toMatchObject({ delta: -2, projectId: null, reservationId: null });
	});

	it('consumes part of a reservation and keeps the rest reserved', async () => {
		const { repos, sku, project } = await setup();
		const r = await repos.reservations.reserve({ projectId: project.id, sku, qty: 5 });
		const partial = await repos.reservations.consume(r.id, { qty: 2 });
		expect(partial).toMatchObject({ status: 'reserved', qtyReserved: 3 });
		expect(await repos.reservations.availability(sku)).toEqual({
			qtyOnHand: 8,
			qtyReserved: 3,
			qtyAvailable: 5
		});
		await expect(repos.reservations.consume(r.id, { qty: 4 })).rejects.toBeInstanceOf(
			InvalidOperationError
		);
		expect((await repos.reservations.consume(r.id, { qty: 3 })).status).toBe('consumed');
		const movements = await repos.stock.movements({ sku, reasons: ['reserve_consume'] });
		expect(movements.map((m) => m.delta).sort()).toEqual([-2, -3]);
		expect(movements.every((m) => m.reservationId === r.id && m.projectId === project.id)).toBe(
			true
		);
	});

	it('consumes all open lines of a project, or none if one is short', async () => {
		const { repos, sku, project } = await setup(10);
		const cat = await createCountCategory(repos, 'Other', 'OTH-');
		const b = await repos.items.create({ categoryId: cat.id, name: 'B', qtyOnHand: 3 });
		await repos.reservations.reserve({ projectId: project.id, sku, qty: 4 });
		await repos.reservations.reserve({ projectId: project.id, sku: b.sku, qty: 3 });
		await repos.stock.adjust({ sku: b.sku, delta: -1, reason: 'consume' });

		await expect(repos.reservations.consumeAll(project.id)).rejects.toBeInstanceOf(
			InsufficientStockError
		);
		expect((await repos.items.get(sku)).qtyOnHand).toBe(10);

		await repos.stock.adjust({ sku: b.sku, delta: 1, reason: 'receive' });
		const consumed = await repos.reservations.consumeAll(project.id, 'built');
		expect(consumed.map((r) => r.status)).toEqual(['consumed', 'consumed']);
		expect((await repos.items.get(sku)).qtyOnHand).toBe(6);
		expect((await repos.items.get(b.sku)).qtyOnHand).toBe(0);
	});

	it('releases all open lines of a project', async () => {
		const { repos, sku, project } = await setup();
		await repos.reservations.reserve({ projectId: project.id, sku, qty: 4 });
		expect(await repos.reservations.releaseAll(project.id)).toBe(1);
		expect(await repos.reservations.releaseAll(project.id)).toBe(0);
		expect((await repos.items.get(sku)).qtyAvailable).toBe(10);
	});

	it('builds a pick list with stock and shortages', async () => {
		const { repos, sku, project, other } = await setup(10);
		const r1 = await repos.reservations.reserve({ projectId: project.id, sku, qty: 6 });
		await repos.reservations.reserve({ projectId: other.id, sku, qty: 4 });
		await repos.stock.adjust({ sku, delta: -5, reason: 'consume' });

		const lines = await repos.reservations.pickList(project.id);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({
			id: r1.id,
			status: 'reserved',
			item: { name: 'Part', qtyOnHand: 5, qtyAvailable: -5 },
			shortBy: 1
		});

		const summary = await repos.projects.getWithSummary(project.id);
		expect(summary).toMatchObject({ openLines: 1, shortLines: 1, consumedLines: 0 });
		const list = await repos.projects.listWithSummary();
		expect(list.find((p) => p.id === other.id)).toMatchObject({ openLines: 1, shortLines: 0 });
	});

	it('lists reservations of an item with their project', async () => {
		const { repos, sku, project } = await setup();
		await repos.reservations.reserve({ projectId: project.id, sku, qty: 1 });
		const [r] = await repos.reservations.listBySkuWithProject(sku);
		expect(r).toMatchObject({ project: { id: project.id, name: 'Amp', status: 'active' } });
	});

	it('only completes or cancels projects without open reservations', async () => {
		const { repos, sku, project } = await setup();
		const r = await repos.reservations.reserve({ projectId: project.id, sku, qty: 1 });
		await expect(repos.projects.update(project.id, { status: 'completed' })).rejects.toThrow(
			/1 open reservation/
		);
		await repos.reservations.consume(r.id);
		expect((await repos.projects.update(project.id, { status: 'completed' })).status).toBe(
			'completed'
		);
	});
});
