import type { Repositories } from '@inventory/db';
import {
	inventoryReportQuerySchema,
	lowStockReportQuerySchema,
	movementsReportQuerySchema,
	projectReportQuerySchema,
	type Report,
	type ReportFormat
} from '@inventory/shared';
import { Hono, type Context } from 'hono';
import { intParam } from '../http/validate.ts';
import {
	inventoryReport,
	lowStockReport,
	movementsReport,
	projectReport
} from '../reports/builders.ts';
import { reportToCsv } from '../reports/csv.ts';
import { renderReportPdf } from '../reports/pdf.ts';

function fileName(report: Report, ext: string): string {
	const date = report.generatedAt.slice(0, 10);
	const slug = report.title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	return `${slug || report.kind}-${date}.${ext}`;
}

async function send(
	c: Context,
	report: Report,
	format: ReportFormat,
	timeZone: string | undefined
): Promise<Response> {
	if (format === 'json') return c.json(report);
	const headers = { 'cache-control': 'no-store' };
	if (format === 'csv') {
		return c.body(reportToCsv(report), 200, {
			...headers,
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="${fileName(report, 'csv')}"`
		});
	}
	const pdf = await renderReportPdf(report, { timeZone });
	return c.body(new Uint8Array(pdf), 200, {
		...headers,
		'content-type': 'application/pdf',
		'content-disposition': `inline; filename="${fileName(report, 'pdf')}"`
	});
}

/** /api/reports (plan §4): ?format=json|csv|pdf on every report. */
export function reportRoutes(repos: Repositories): Hono {
	const app = new Hono();

	app.get('/inventory', async (c) => {
		const q = inventoryReportQuerySchema.parse(c.req.query());
		return send(c, await inventoryReport(repos, q), q.format, q.tz);
	});

	app.get('/low-stock', async (c) => {
		const q = lowStockReportQuerySchema.parse(c.req.query());
		return send(c, await lowStockReport(repos, q), q.format, q.tz);
	});

	app.get('/project/:id', async (c) => {
		const q = projectReportQuerySchema.parse(c.req.query());
		return send(c, await projectReport(repos, intParam(c, 'id')), q.format, q.tz);
	});

	app.get('/movements', async (c) => {
		const q = movementsReportQuerySchema.parse(c.req.query());
		return send(c, await movementsReport(repos, q), q.format, q.tz);
	});

	return app;
}
