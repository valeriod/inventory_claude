import { describe, expect, it } from 'vitest';
import { bomQuantities } from './api/projects.ts';

describe('bomQuantities', () => {
	const base = { needed: 10, used: 0, reserved: 0, onHand: 100, available: 100 };

	it('reserves from available stock and buys nothing when there is enough', () => {
		expect(bomQuantities(base)).toEqual({ remaining: 10, canReserve: 10, toBuy: 0 });
	});

	it('buys what available stock cannot cover', () => {
		expect(bomQuantities({ ...base, onHand: 4, available: 4 })).toEqual({
			remaining: 10,
			canReserve: 4,
			toBuy: 6
		});
	});

	it('counts used and reserved parts against the need', () => {
		expect(bomQuantities({ ...base, used: 3, reserved: 5, onHand: 5, available: 0 })).toEqual({
			remaining: 2,
			canReserve: 0,
			toBuy: 2
		});
		expect(bomQuantities({ ...base, used: 12 })).toEqual({ remaining: 0, canReserve: 0, toBuy: 0 });
	});

	it('buys reserved stock that is no longer on hand, and handles over-commitment', () => {
		expect(bomQuantities({ needed: null, used: 0, reserved: 6, onHand: 5, available: -5 })).toEqual(
			{ remaining: 0, canReserve: 0, toBuy: 1 }
		);
		expect(bomQuantities({ ...base, onHand: 5, available: -2 })).toEqual({
			remaining: 10,
			canReserve: 0,
			toBuy: 10
		});
	});
});
