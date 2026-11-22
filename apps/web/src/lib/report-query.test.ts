import { describe, expect, it } from 'vitest';
import { reportKind, toApiQuery } from './report-query.ts';

describe('report query', () => {
	it('defaults to the inventory report', () => {
		expect(reportKind(new URLSearchParams('report=movements'))).toBe('movements');
		expect(reportKind(new URLSearchParams('report=bogus'))).toBe('inventory');
	});

	it('turns inclusive local days into an ISO range with an exclusive end', () => {
		const q = toApiQuery(
			new URLSearchParams('report=movements&fromDate=2026-03-01&toDate=2026-03-31&sku=A')
		);
		expect(q.get('fromDate')).toBeNull();
		expect(new Date(q.get('from')!).getDate()).toBe(1);
		const to = new Date(q.get('to')!);
		expect([to.getMonth(), to.getDate(), to.getHours()]).toEqual([3, 1, 0]);
		expect(q.get('sku')).toBe('A');
	});

	it('ignores malformed dates', () => {
		expect(toApiQuery(new URLSearchParams('fromDate=yesterday')).has('from')).toBe(false);
	});
});
