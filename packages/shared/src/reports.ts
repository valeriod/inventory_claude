import { z } from 'zod';
import { movementReasonSchema } from './enums.ts';
import { skuSchema } from './sku.ts';

/**
 * Reports (plan §M7) are built once on the server as typed columns and rows; the same structure
 * is previewed in the app, exported as CSV and rendered as PDF.
 */
export type ReportColumnType = 'text' | 'number' | 'datetime';

export interface ReportColumn {
	key: string;
	label: string;
	type: ReportColumnType;
	/** Relative width in the PDF (default 1). */
	width?: number;
}

/** Numbers are quantities in the row's display unit; datetimes are ISO strings. */
export type ReportCell = string | number | null;

export interface Report {
	kind: ReportKind;
	title: string;
	/** Filter descriptions, e.g. "Category: Resistors". */
	filters: string[];
	generatedAt: string;
	columns: ReportColumn[];
	rows: Record<string, ReportCell>[];
	summary: { label: string; value: string }[];
	/** True when the row limit cut the report short. */
	truncated: boolean;
}

export const REPORT_KINDS = ['inventory', 'low-stock', 'project', 'movements'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const reportFormatSchema = z.enum(['json', 'csv', 'pdf']).default('json');
export type ReportFormat = z.infer<typeof reportFormatSchema>;

const boolParam = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const id = z.coerce.number().int().positive();

/** IANA time zone used to print dates in PDFs (defaults to the server's). */
const timeZone = z
	.string()
	.max(64)
	.optional()
	.refine(
		(tz) => {
			if (!tz) return true;
			try {
				new Intl.DateTimeFormat('en', { timeZone: tz });
				return true;
			} catch {
				return false;
			}
		},
		{ message: 'Unknown time zone' }
	);

const common = { format: reportFormatSchema, tz: timeZone };

export const inventoryReportQuerySchema = z.object({
	...common,
	category: id.optional(),
	location: id.optional(),
	includeArchived: boolParam.default(false)
});

export const lowStockReportQuerySchema = z.object({
	...common,
	category: id.optional(),
	location: id.optional()
});

export const projectReportQuerySchema = z.object({ ...common });

/** `from` / `to` are ISO timestamps; `to` is exclusive. */
export const movementsReportQuerySchema = z
	.object({
		...common,
		from: z.iso.datetime({ offset: true }).optional(),
		to: z.iso.datetime({ offset: true }).optional(),
		sku: skuSchema.optional(),
		reason: movementReasonSchema.optional(),
		project: id.optional()
	})
	.refine((q) => !q.from || !q.to || Date.parse(q.from) < Date.parse(q.to), {
		message: '"from" must be before "to"',
		path: ['to']
	});

/** Row limit for reports that can grow without bound (movements). */
export const MAX_REPORT_ROWS = 10_000;
