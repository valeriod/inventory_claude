import { z } from 'zod';
import { SKU_PATTERN } from './sku.ts';

/** A label stock: either a sheet with a grid of labels, or a roll with one label per page. */
export interface LabelLayout {
	id: string;
	name: string;
	/** Page size in millimetres. */
	pageWidth: number;
	pageHeight: number;
	columns: number;
	rows: number;
	/** Label size in millimetres. */
	labelWidth: number;
	labelHeight: number;
	/** Offset of the top-left label from the page corner. */
	marginLeft: number;
	marginTop: number;
	/** Space between columns / rows. */
	gapX: number;
	gapY: number;
}

function sheet(
	id: string,
	name: string,
	page: 'a4' | 'letter',
	grid: [columns: number, rows: number],
	label: [width: number, height: number],
	margins: [left: number, top: number],
	gaps: [x: number, y: number] = [0, 0]
): LabelLayout {
	const [pageWidth, pageHeight] = page === 'a4' ? [210, 297] : [215.9, 279.4];
	return {
		id,
		name,
		pageWidth,
		pageHeight,
		columns: grid[0],
		rows: grid[1],
		labelWidth: label[0],
		labelHeight: label[1],
		marginLeft: margins[0],
		marginTop: margins[1],
		gapX: gaps[0],
		gapY: gaps[1]
	};
}

function roll(id: string, name: string, width: number, height: number): LabelLayout {
	return {
		id,
		name,
		pageWidth: width,
		pageHeight: height,
		columns: 1,
		rows: 1,
		labelWidth: width,
		labelHeight: height,
		marginLeft: 0,
		marginTop: 0,
		gapX: 0,
		gapY: 0
	};
}

export const LABEL_LAYOUTS = [
	sheet('a4-3x8', 'A4 sheet, 24 labels 70 × 37 mm', 'a4', [3, 8], [70, 37], [0, 0.5]),
	sheet(
		'a4-5x13',
		'A4 sheet, 65 labels 38.1 × 21.2 mm (Avery L7651)',
		'a4',
		[5, 13],
		[38.1, 21.2],
		[4.75, 10.7],
		[2.5, 0]
	),
	sheet(
		'letter-3x10',
		'Letter sheet, 30 labels 2⅝ × 1 in (Avery 5160)',
		'letter',
		[3, 10],
		[66.675, 25.4],
		[4.7625, 12.7],
		[3.175, 0]
	),
	roll('roll-62x29', 'Label printer, 62 × 29 mm (Brother DK-11209)', 62, 29),
	roll('roll-50x25', 'Label printer, 50 × 25 mm', 50, 25)
] as const satisfies readonly LabelLayout[];

export type LabelLayoutId = (typeof LABEL_LAYOUTS)[number]['id'];

export const DEFAULT_LABEL_LAYOUT: LabelLayoutId = 'a4-3x8';

export function labelLayout(id: string): LabelLayout | undefined {
	return LABEL_LAYOUTS.find((l) => l.id === id);
}

export function labelsPerPage(layout: LabelLayout): number {
	return layout.columns * layout.rows;
}

/** Upper bound on labels per request, to keep the PDF and the URL a reasonable size. */
export const MAX_LABELS = 300;

const codeList = z
	.string()
	.optional()
	.transform((v) => [
		...new Set(
			(v ?? '')
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		)
	])
	.pipe(
		z.array(z.string().regex(SKU_PATTERN, 'Invalid code')).max(MAX_LABELS, {
			message: `At most ${MAX_LABELS} labels per request`
		})
	);

const idList = z
	.string()
	.optional()
	.transform((v) => [
		...new Set(
			(v ?? '')
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		)
	])
	.pipe(
		z
			.array(z.string().regex(/^[1-9]\d{0,15}$/, 'Invalid project id'))
			.max(MAX_LABELS)
			.transform((ids) => ids.map(Number))
	);

/** Query of GET /api/labels: comma-separated SKUs, location codes and project ids. */
export const labelsQuerySchema = z
	.object({
		skus: codeList,
		locations: codeList,
		projects: idList,
		layout: z
			.string()
			.default(DEFAULT_LABEL_LAYOUT)
			.refine((v) => labelLayout(v) !== undefined, { message: 'Unknown label layout' }),
		/** Leave this many positions empty at the start (partly used sheets). */
		skip: z.coerce.number().int().min(0).max(200).default(0),
		/** Draw label outlines, for test prints. */
		outline: z
			.enum(['true', 'false', '1', '0'])
			.default('false')
			.transform((v) => v === 'true' || v === '1')
	})
	.refine((q) => q.skus.length + q.locations.length + q.projects.length > 0, {
		message: 'Give at least one SKU, location code or project',
		path: ['skus']
	})
	.refine((q) => q.skus.length + q.locations.length + q.projects.length <= MAX_LABELS, {
		message: `At most ${MAX_LABELS} labels per request`,
		path: ['skus']
	});

export type LabelsQuery = z.output<typeof labelsQuerySchema>;

/** Position (in mm, from the top-left page corner) of the n-th label slot on a page. */
export function labelSlot(layout: LabelLayout, index: number): { x: number; y: number } {
	const column = index % layout.columns;
	const row = Math.floor(index / layout.columns);
	return {
		x: layout.marginLeft + column * (layout.labelWidth + layout.gapX),
		y: layout.marginTop + row * (layout.labelHeight + layout.gapY)
	};
}
