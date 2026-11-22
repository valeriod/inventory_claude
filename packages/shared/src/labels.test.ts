import { describe, expect, it } from 'vitest';
import {
	LABEL_LAYOUTS,
	labelSlot,
	labelsPerPage,
	labelsQuerySchema,
	MAX_LABELS
} from './labels.ts';

describe('label layouts', () => {
	it.each(LABEL_LAYOUTS.map((l) => [l.id, l] as const))('%s fits on its page', (_, layout) => {
		const last = labelSlot(layout, labelsPerPage(layout) - 1);
		expect(last.x + layout.labelWidth).toBeLessThanOrEqual(layout.pageWidth + 0.01);
		expect(last.y + layout.labelHeight).toBeLessThanOrEqual(layout.pageHeight + 0.01);
	});

	it('places slots row by row', () => {
		const layout = LABEL_LAYOUTS.find((l) => l.id === 'a4-3x8')!;
		expect(labelSlot(layout, 0)).toEqual({ x: 0, y: 0.5 });
		expect(labelSlot(layout, 2)).toEqual({ x: 140, y: 0.5 });
		expect(labelSlot(layout, 3)).toEqual({ x: 0, y: 37.5 });
	});
});

describe('labelsQuerySchema', () => {
	it('parses lists, trims and de-duplicates', () => {
		const q = labelsQuerySchema.parse({ skus: 'A-1, B-2,,A-1', locations: 'BIN-1' });
		expect(q).toMatchObject({
			skus: ['A-1', 'B-2'],
			locations: ['BIN-1'],
			layout: 'a4-3x8',
			skip: 0,
			outline: false
		});
	});

	it('requires at least one code', () => {
		expect(labelsQuerySchema.safeParse({}).success).toBe(false);
	});

	it('rejects unknown layouts, bad codes and too many labels', () => {
		expect(labelsQuerySchema.safeParse({ skus: 'A', layout: 'nope' }).success).toBe(false);
		expect(labelsQuerySchema.safeParse({ skus: 'A/B' }).success).toBe(false);
		const many = Array.from({ length: MAX_LABELS }, (_, i) => `S${i}`).join(',');
		expect(labelsQuerySchema.safeParse({ skus: many, locations: 'X' }).success).toBe(false);
	});
});
