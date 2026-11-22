import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError } from './errors.ts';
import { createCountCategory, useTestDatabase } from './test-helpers.ts';

describe('ProjectPartRepository', () => {
	const fx = useTestDatabase();

	async function setup() {
		const { repos } = fx();
		const cat = await createCountCategory(repos);
		const a = await repos.items.create({ categoryId: cat.id, name: 'A part', qtyOnHand: 10 });
		const b = await repos.items.create({ categoryId: cat.id, name: 'B part', qtyOnHand: 2 });
		const c = await repos.items.create({ categoryId: cat.id, name: 'C part', qtyOnHand: 5 });
		const project = await repos.projects.create({ name: 'Amp', status: 'active' });
		return { repos, a: a.sku, b: b.sku, c: c.sku, project };
	}

	it('sets, replaces and removes needed quantities', async () => {
		const { repos, a, project } = await setup();
		await repos.projectParts.set({ projectId: project.id, sku: a, qtyNeeded: 4, note: 'R1-R4' });
		const replaced = await repos.projectParts.set({ projectId: project.id, sku: a, qtyNeeded: 6 });
		expect(replaced).toMatchObject({ qtyNeeded: 6, note: 'R1-R4' });
		expect(await repos.projectParts.list(project.id)).toHaveLength(1);
		await repos.projectParts.remove(project.id, a);
		await expect(repos.projectParts.remove(project.id, a)).rejects.toBeInstanceOf(NotFoundError);
		await expect(
			repos.projectParts.set({ projectId: project.id, sku: 'NOPE', qtyNeeded: 1 })
		).rejects.toBeInstanceOf(NotFoundError);
	});

	it('combines needs, reservations and use into a bill of materials', async () => {
		const { repos, a, b, c, project } = await setup();
		await repos.projectParts.set({ projectId: project.id, sku: a, qtyNeeded: 6 });
		await repos.projectParts.set({ projectId: project.id, sku: b, qtyNeeded: 5 });
		const r = await repos.reservations.reserve({ projectId: project.id, sku: a, qty: 4 });
		await repos.reservations.consume(r.id, { qty: 1 }); // used 1, reserved 3
		await repos.reservations.reserve({ projectId: project.id, sku: c, qty: 2 }); // not on the list

		const bom = await repos.projectParts.bom(project.id);
		expect(bom.map((l) => l.sku)).toEqual([a, b, c]);
		expect(bom[0]).toMatchObject({
			qtyNeeded: 6,
			qtyUsed: 1,
			qtyReserved: 3,
			qtyRemaining: 2,
			qtyCanReserve: 2,
			qtyToBuy: 0
		});
		expect(bom[1]).toMatchObject({ qtyNeeded: 5, qtyRemaining: 5, qtyCanReserve: 2, qtyToBuy: 3 });
		expect(bom[2]).toMatchObject({ qtyNeeded: null, qtyReserved: 2, qtyToBuy: 0 });
	});

	it('reserves what available stock covers for every needed line', async () => {
		const { repos, a, b, project } = await setup();
		await repos.projectParts.set({ projectId: project.id, sku: a, qtyNeeded: 6 });
		await repos.projectParts.set({ projectId: project.id, sku: b, qtyNeeded: 5 });
		expect(await repos.projectParts.reserveNeeded(project.id)).toBe(2);
		const bom = await repos.projectParts.bom(project.id);
		expect(bom.map((l) => [l.qtyReserved, l.qtyCanReserve, l.qtyToBuy])).toEqual([
			[6, 0, 0],
			[2, 0, 3]
		]);
		expect(await repos.projectParts.reserveNeeded(project.id)).toBe(0);
	});

	it('keeps items on a parts list from being deleted', async () => {
		const { repos, project } = await setup();
		// No stock history, so only the parts list keeps it from being deleted.
		const cat = await createCountCategory(repos, 'Spare', 'SPR-');
		const { sku } = await repos.items.create({ categoryId: cat.id, name: 'Spare' });
		await repos.projectParts.set({ projectId: project.id, sku, qtyNeeded: 1 });
		await expect(repos.items.delete(sku)).rejects.toBeInstanceOf(ConflictError);
		await repos.projects.delete(project.id);
		expect(await repos.projectParts.list(project.id)).toEqual([]);
	});
});
