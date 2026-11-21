import { describe, expect, it } from 'vitest';
import { seedDemoData } from './seed.ts';
import { useTestDatabase } from './test-helpers.ts';

describe('seedDemoData', () => {
	const fx = useTestDatabase();

	it('seeds an empty database once', async () => {
		const { repos } = fx();
		expect(await seedDemoData(repos)).toBe(true);
		expect(await seedDemoData(repos)).toBe(false);

		expect(await repos.categories.list()).toHaveLength(7);
		const { items, total } = await repos.items.list({ limit: 100 });
		expect(total).toBe(11);

		const wire = items.find((i) => i.name === 'Hookup wire 22AWG red');
		expect(wire).toMatchObject({ qtyOnHand: 37_500, qtyReserved: 1_500, qtyAvailable: 36_000 });

		const low = await repos.items.list({ lowStock: true });
		expect(low.items.map((i) => i.name).sort()).toEqual([
			'4.7kΩ 1% 0603',
			'Hookup wire 22AWG black'
		]);
		expect((await repos.items.findByBarcode('0123456789012'))?.name).toBe(
			'LM317 adjustable regulator'
		);
	});
});
