import { describe, expect, it } from 'vitest';
import { ConflictError, InvalidOperationError, NotFoundError } from './errors.ts';
import type { Repositories } from './repositories/index.ts';
import { createCountCategory, useTestDatabase } from './test-helpers.ts';

async function seedItems(repos: Repositories) {
	const res = await createCountCategory(repos);
	const wire = await repos.categories.create({
		name: 'Wire',
		skuPrefix: 'WIR-',
		unitKind: 'length',
		displayUnit: 'm',
		fieldDefs: [
			{ key: 'gauge_awg', label: 'Gauge', type: 'number' },
			{ key: 'color', label: 'Colour', type: 'text' }
		]
	});
	const bin = await repos.locations.create({ name: 'Bin A1', code: 'A1' });
	const r10k = await repos.items.create({
		categoryId: res.id,
		name: '10kΩ resistor',
		qtyOnHand: 450,
		qtyMin: 100,
		locationId: bin.id,
		attributes: { resistance: 10_000, package: '0603', tags: ['smd', 'precision'], rohs: true }
	});
	const r220 = await repos.items.create({
		categoryId: res.id,
		name: '220Ω resistor',
		qtyOnHand: 50,
		qtyMin: 100,
		attributes: { resistance: 220, package: 'THT', tags: [], rohs: false }
	});
	const red = await repos.items.create({
		categoryId: wire.id,
		name: 'Hookup wire red',
		description: 'Stranded, PVC insulation',
		qtyOnHand: 37_500,
		barcode: '4006381333931',
		attributes: { gauge_awg: 22, color: 'red' }
	});
	const black = await repos.items.create({
		categoryId: wire.id,
		name: 'Hookup wire black',
		qtyOnHand: 1_000,
		attributes: { gauge_awg: 18, color: 'black' }
	});
	return { res, wire, bin, r10k, r220, red, black };
}

describe('ItemRepository', () => {
	const fx = useTestDatabase();

	describe('create', () => {
		it('generates a SKU and records initial stock as a receive movement', async () => {
			const { repos } = fx();
			const { r10k } = await seedItems(repos);
			expect(r10k).toMatchObject({
				sku: 'RES-0001',
				qtyOnHand: 450,
				qtyReserved: 0,
				qtyAvailable: 450,
				version: 1,
				archivedAt: null,
				attributes: { resistance: 10_000, package: '0603', tags: ['smd', 'precision'], rohs: true }
			});
			const movements = await repos.stock.movements({ sku: r10k.sku });
			expect(movements).toMatchObject([{ delta: 450, reason: 'receive', note: 'Initial stock' }]);
		});

		it('creates an item with zero stock and no movement', async () => {
			const { repos } = fx();
			const cat = await createCountCategory(repos);
			const item = await repos.items.create({ sku: 'MANUAL-1', categoryId: cat.id, name: 'x' });
			expect(item.qtyOnHand).toBe(0);
			expect(await repos.stock.movements({ sku: 'MANUAL-1' })).toEqual([]);
		});

		it('rejects duplicate SKUs and barcodes', async () => {
			const { repos } = fx();
			const { res, red } = await seedItems(repos);
			await expect(
				repos.items.create({ sku: red.sku, categoryId: res.id, name: 'dup' })
			).rejects.toBeInstanceOf(ConflictError);
			await expect(
				repos.items.create({ categoryId: res.id, name: 'dup', barcode: ' 4006381333931 ' })
			).rejects.toThrow(/already assigned to WIR-0001/);
		});

		it('rejects invalid SKUs, quantities and unknown categories', async () => {
			const { repos } = fx();
			const cat = await createCountCategory(repos);
			await expect(
				repos.items.create({ sku: 'a/b', categoryId: cat.id, name: 'x' })
			).rejects.toThrow();
			await expect(
				repos.items.create({ categoryId: cat.id, name: 'x', qtyOnHand: 1.5 })
			).rejects.toBeInstanceOf(InvalidOperationError);
			await expect(
				repos.items.create({ sku: 'X-1', categoryId: 999, name: 'x' })
			).rejects.toBeInstanceOf(ConflictError);
		});

		it('rolls back the item if the initial stock fails', async () => {
			const { repos } = fx();
			const cat = await createCountCategory(repos);
			await expect(
				repos.items.create({ sku: 'X-1', categoryId: cat.id, name: 'x', qtyOnHand: -5 })
			).rejects.toBeInstanceOf(InvalidOperationError);
			expect(await repos.items.find('X-1')).toBeUndefined();
		});
	});

	describe('lookup', () => {
		it('finds by barcode', async () => {
			const { repos } = fx();
			const { red } = await seedItems(repos);
			expect((await repos.items.findByBarcode('4006381333931'))?.sku).toBe(red.sku);
			expect(await repos.items.findByBarcode('nope')).toBeUndefined();
			expect(await repos.items.findByBarcode('  ')).toBeUndefined();
		});

		it('throws NotFoundError for unknown SKUs', async () => {
			await expect(fx().repos.items.get('NOPE')).rejects.toBeInstanceOf(NotFoundError);
		});
	});

	describe('update', () => {
		it('updates details, bumps the version and re-indexes search text', async () => {
			const { repos } = fx();
			const { r10k } = await seedItems(repos);
			const updated = await repos.items.update(r10k.sku, { name: 'Ten kilo-ohm' }, r10k.version);
			expect(updated).toMatchObject({ name: 'Ten kilo-ohm', version: 2, qtyOnHand: 450 });
			expect((await repos.items.list({ q: 'kilo' })).items.map((i) => i.sku)).toEqual([r10k.sku]);
			expect((await repos.items.list({ q: '10kΩ' })).total).toBe(0);
		});

		it('detects concurrent edits via the expected version', async () => {
			const { repos } = fx();
			const { r10k } = await seedItems(repos);
			await repos.items.update(r10k.sku, { name: 'first' }, 1);
			await expect(repos.items.update(r10k.sku, { name: 'second' }, 1)).rejects.toBeInstanceOf(
				ConflictError
			);
		});

		it('does not bump the version on stock changes', async () => {
			const { repos } = fx();
			const { r10k } = await seedItems(repos);
			await repos.stock.adjust({ sku: r10k.sku, delta: -1, reason: 'consume' });
			expect((await repos.items.update(r10k.sku, { qtyMin: 5 }, 1)).version).toBe(2);
		});

		it('refuses to move an item to a category with a different unit kind', async () => {
			const { repos } = fx();
			const { r10k, wire } = await seedItems(repos);
			await expect(repos.items.update(r10k.sku, { categoryId: wire.id })).rejects.toBeInstanceOf(
				InvalidOperationError
			);
		});

		it('rejects a barcode used by another item but allows keeping its own', async () => {
			const { repos } = fx();
			const { r10k, red } = await seedItems(repos);
			await expect(repos.items.update(r10k.sku, { barcode: red.barcode })).rejects.toBeInstanceOf(
				ConflictError
			);
			expect((await repos.items.update(red.sku, { barcode: red.barcode })).barcode).toBe(
				red.barcode
			);
		});
	});

	describe('archive and delete', () => {
		it('hides archived items from lists by default', async () => {
			const { repos } = fx();
			const { r220 } = await seedItems(repos);
			await repos.items.archive(r220.sku);
			expect((await repos.items.list()).items.map((i) => i.sku)).not.toContain(r220.sku);
			expect((await repos.items.list({ includeArchived: true })).total).toBe(4);
			expect((await repos.items.restore(r220.sku)).archivedAt).toBeNull();
		});

		it('only hard-deletes items without history', async () => {
			const { repos } = fx();
			const { res, r10k } = await seedItems(repos);
			await expect(repos.items.delete(r10k.sku)).rejects.toThrow(/archive it instead/);
			const fresh = await repos.items.create({ categoryId: res.id, name: 'typo' });
			await repos.items.delete(fresh.sku);
			expect(await repos.items.find(fresh.sku)).toBeUndefined();
		});
	});

	describe('list', () => {
		it('paginates with a total count and stable sort', async () => {
			const { repos } = fx();
			await seedItems(repos);
			const page1 = await repos.items.list({ sort: 'sku', limit: 3 });
			const page2 = await repos.items.list({ sort: 'sku', limit: 3, offset: 3 });
			expect(page1.total).toBe(4);
			expect([...page1.items, ...page2.items].map((i) => i.sku)).toEqual([
				'RES-0001',
				'RES-0002',
				'WIR-0001',
				'WIR-0002'
			]);
			const byQty = await repos.items.list({ sort: 'qty', direction: 'desc', limit: 1 });
			expect(byQty.items[0]?.sku).toBe('WIR-0001');
		});

		it('filters by category and location', async () => {
			const { repos } = fx();
			const { wire, bin, r10k } = await seedItems(repos);
			expect((await repos.items.list({ categoryIds: [wire.id] })).total).toBe(2);
			expect((await repos.items.list({ locationId: bin.id })).items.map((i) => i.sku)).toEqual([
				r10k.sku
			]);
		});

		it.each([
			['resistor', ['RES-0001', 'RES-0002']],
			['RES-0001', ['RES-0001']],
			['res 0001', ['RES-0001']],
			['10k', ['RES-0001']],
			['hook', ['WIR-0001', 'WIR-0002']],
			['wire red', ['WIR-0001']],
			['pvc', ['WIR-0001']],
			['STRANDED', ['WIR-0001']],
			['4006381333931', ['WIR-0001']],
			['precision', ['RES-0001']],
			['22', ['RES-0002', 'WIR-0001']], // prefix match: 22* also matches 220Ω
			['220', ['RES-0002']],
			['nothing-matches', []]
		])('full-text search %j', async (q, expected) => {
			const { repos } = fx();
			await seedItems(repos);
			const { items } = await repos.items.list({ q, sort: 'sku' });
			expect(items.map((i) => i.sku)).toEqual(expected);
		});

		it('ignores queries without searchable tokens', async () => {
			const { repos } = fx();
			await seedItems(repos);
			expect((await repos.items.list({ q: '"*-()' })).total).toBe(4);
		});

		it('filters on JSON attributes', async () => {
			const { repos } = fx();
			await seedItems(repos);
			const skus = async (attributes: Parameters<Repositories['items']['list']>[0]) =>
				(await repos.items.list({ ...attributes, sort: 'sku' })).items.map((i) => i.sku);

			expect(await skus({ attributes: [{ key: 'color', op: 'eq', value: 'red' }] })).toEqual([
				'WIR-0001'
			]);
			expect(await skus({ attributes: [{ key: 'gauge_awg', op: 'eq', value: 18 }] })).toEqual([
				'WIR-0002'
			]);
			expect(await skus({ attributes: [{ key: 'rohs', op: 'eq', value: true }] })).toEqual([
				'RES-0001'
			]);
			expect(await skus({ attributes: [{ key: 'rohs', op: 'eq', value: false }] })).toEqual([
				'RES-0002'
			]);
			expect(await skus({ attributes: [{ key: 'tags', op: 'contains', value: 'smd' }] })).toEqual([
				'RES-0001'
			]);
			expect(await skus({ attributes: [{ key: 'resistance', op: 'gte', value: 1000 }] })).toEqual([
				'RES-0001'
			]);
			expect(
				await skus({
					attributes: [
						{ key: 'gauge_awg', op: 'gte', value: 18 },
						{ key: 'gauge_awg', op: 'lte', value: 20 }
					]
				})
			).toEqual(['WIR-0002']);
			// A string value never equals a number and vice versa
			expect(await skus({ attributes: [{ key: 'gauge_awg', op: 'eq', value: '22' }] })).toEqual([]);
			// Combined with search
			expect(
				await skus({ q: 'wire', attributes: [{ key: 'color', op: 'eq', value: 'black' }] })
			).toEqual(['WIR-0002']);
		});

		it('rejects unsafe attribute keys', async () => {
			await expect(
				fx().repos.items.list({ attributes: [{ key: "x') or 1=1 --", op: 'eq', value: 1 }] })
			).rejects.toThrow(/Invalid attribute key/);
		});

		it('reports low stock using available quantity', async () => {
			const { repos } = fx();
			const { r10k, r220 } = await seedItems(repos);
			expect((await repos.items.list({ lowStock: true })).items.map((i) => i.sku)).toEqual([
				r220.sku
			]);

			const project = await repos.projects.create({ name: 'P', status: 'active' });
			await repos.reservations.reserve({ projectId: project.id, sku: r10k.sku, qty: 360 });
			const low = await repos.items.list({ lowStock: true, sort: 'sku' });
			expect(low.items.map((i) => i.sku)).toEqual([r10k.sku, r220.sku]);
			expect(low.items[0]).toMatchObject({ qtyOnHand: 450, qtyReserved: 360, qtyAvailable: 90 });
		});

		it('creates expression indexes for attribute fields', async () => {
			const { repos, db } = fx();
			await seedItems(repos);
			await db.adapter.ensureFieldIndex(db.db, 'gauge_awg', 'number');
			await db.adapter.ensureFieldIndex(db.db, 'gauge_awg', 'number'); // idempotent
			await db.adapter.ensureFieldIndex(db.db, 'color', 'text');
			expect(
				(await repos.items.list({ attributes: [{ key: 'gauge_awg', op: 'gte', value: 20 }] })).total
			).toBe(1);
		});
	});
});
