import { describe, expect, it } from 'vitest';
import { InsufficientStockError, InvalidOperationError, NotFoundError } from './errors.ts';
import { createCountCategory, useTestDatabase } from './test-helpers.ts';

describe('StockRepository', () => {
	const fx = useTestDatabase();

	async function item(qty: number) {
		const { repos } = fx();
		const cat = await createCountCategory(repos);
		return repos.items.create({ categoryId: cat.id, name: 'Part', qtyOnHand: qty });
	}

	it('receives and consumes stock with a ledger entry each time', async () => {
		const { repos } = fx();
		const { sku } = await item(10);
		expect((await repos.stock.adjust({ sku, delta: 5, reason: 'receive' })).qtyOnHand).toBe(15);
		const res = await repos.stock.adjust({ sku, delta: -3, reason: 'consume', note: 'used' });
		expect(res.qtyOnHand).toBe(12);
		expect(res.movement).toMatchObject({ sku, delta: -3, reason: 'consume', note: 'used' });
		expect((await repos.stock.movements({ sku })).map((m) => m.delta)).toEqual([-3, 5, 10]);
		expect((await repos.items.get(sku)).qtyOnHand).toBe(12);
	});

	it('never goes below zero', async () => {
		const { repos } = fx();
		const { sku } = await item(2);
		const err = await repos.stock.adjust({ sku, delta: -3, reason: 'consume' }).catch((e) => e);
		expect(err).toBeInstanceOf(InsufficientStockError);
		expect(err).toMatchObject({ requested: 3, available: 2 });
		expect((await repos.items.get(sku)).qtyOnHand).toBe(2);
		expect(await repos.stock.movements({ sku })).toHaveLength(1);
	});

	it('validates delta sign, size and target', async () => {
		const { repos } = fx();
		const { sku } = await item(2);
		const bad = [
			{ sku, delta: -1, reason: 'receive' as const },
			{ sku, delta: 1, reason: 'consume' as const },
			{ sku, delta: 0, reason: 'adjust' as const },
			{ sku, delta: 0.5, reason: 'adjust' as const }
		];
		for (const input of bad) {
			await expect(repos.stock.adjust(input)).rejects.toBeInstanceOf(InvalidOperationError);
		}
		await expect(
			repos.stock.adjust({ sku: 'NOPE', delta: 1, reason: 'adjust' })
		).rejects.toBeInstanceOf(NotFoundError);
	});

	it('records counts as the difference from the recorded quantity', async () => {
		const { repos } = fx();
		const { sku } = await item(10);
		const result = await repos.stock.count({ sku, countedQty: 7, note: 'stocktake' });
		expect(result.qtyOnHand).toBe(7);
		expect(result.movement).toMatchObject({ delta: -3, reason: 'count' });
		expect(await repos.stock.count({ sku, countedQty: 7 })).toMatchObject({
			qtyOnHand: 7,
			movement: null
		});
	});

	it('filters movements by reason and time range', async () => {
		const { repos } = fx();
		const { sku } = await item(10);
		await repos.stock.adjust({ sku, delta: -1, reason: 'consume' });
		expect(await repos.stock.movements({ reasons: ['consume'] })).toHaveLength(1);
		expect(await repos.stock.movements({ from: '2999-01-01T00:00:00.000Z' })).toEqual([]);
		expect(await repos.stock.movements({ to: '2999-01-01T00:00:00.000Z' })).toHaveLength(2);
	});

	it('handles concurrent decrements without overselling', async () => {
		const { repos } = fx();
		const { sku } = await item(10);
		const results = await Promise.allSettled(
			Array.from({ length: 25 }, () => repos.stock.adjust({ sku, delta: -1, reason: 'consume' }))
		);
		const ok = results.filter((r) => r.status === 'fulfilled');
		const failed = results.filter((r) => r.status === 'rejected');
		expect(ok).toHaveLength(10);
		expect(failed.every((r) => r.reason instanceof InsufficientStockError)).toBe(true);
		expect((await repos.items.get(sku)).qtyOnHand).toBe(0);
		expect(await repos.stock.movements({ sku, reasons: ['consume'] })).toHaveLength(10);
	});

	it('applies a keyed stock change only once', async () => {
		const { repos } = fx();
		const cat = await createCountCategory(repos);
		const { sku } = await repos.items.create({ categoryId: cat.id, name: 'Keyed', qtyOnHand: 10 });
		const input = { sku, delta: -3, reason: 'consume' as const };
		const first = await repos.stock.adjustOnce(input, 'movement:abc12345');
		const again = await repos.stock.adjustOnce(input, 'movement:abc12345');
		expect(first.replayed).toBe(false);
		expect(again).toEqual({ result: first.result, replayed: true });
		expect((await repos.items.get(sku)).qtyOnHand).toBe(7);

		const counted = await repos.stock.countOnce({ sku, countedQty: 5 }, 'count:abc12345');
		await repos.stock.adjust({ sku, delta: 4, reason: 'receive' });
		const replay = await repos.stock.countOnce({ sku, countedQty: 5 }, 'count:abc12345');
		expect(replay).toEqual({ result: counted.result, replayed: true });
		expect((await repos.items.get(sku)).qtyOnHand).toBe(9);
	});

	it('does not store the key when the change fails', async () => {
		const { repos } = fx();
		const cat = await createCountCategory(repos);
		const { sku } = await repos.items.create({ categoryId: cat.id, name: 'Few', qtyOnHand: 1 });
		const input = { sku, delta: -2, reason: 'consume' as const };
		await expect(repos.stock.adjustOnce(input, 'movement:fail1234')).rejects.toBeInstanceOf(
			InsufficientStockError
		);
		await repos.stock.adjust({ sku, delta: 5, reason: 'receive' });
		const retry = await repos.stock.adjustOnce(input, 'movement:fail1234');
		expect(retry.replayed).toBe(false);
		expect((await repos.items.get(sku)).qtyOnHand).toBe(4);
	});
});
