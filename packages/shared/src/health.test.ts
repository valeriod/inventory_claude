import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health.ts';

describe('healthResponseSchema', () => {
	it('accepts a valid response', () => {
		expect(
			healthResponseSchema.parse({ status: 'ok', version: '0.0.0', database: 'sqlite' })
		).toEqual({ status: 'ok', version: '0.0.0', database: 'sqlite' });
	});

	it('rejects an unknown dialect', () => {
		expect(() =>
			healthResponseSchema.parse({ status: 'ok', version: '0.0.0', database: 'mysql' })
		).toThrow();
	});
});
