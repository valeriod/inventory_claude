import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { dumpDatabase, type DatabaseConnection, type Repositories } from '@inventory/db';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { BadRequestError } from '../http/errors.ts';
import { exportItemsCsv, importItemsCsv, importTemplateCsv } from '../import/items-csv.ts';
import { VERSION } from '../version.ts';

const boolParam = z
	.enum(['true', 'false', '1', '0'])
	.default('false')
	.transform((v) => v === 'true' || v === '1');

const importQuerySchema = z.object({
	category: z.coerce.number().int().positive().optional(),
	updateStock: boolParam,
	commit: boolParam
});

function stamp(): string {
	return new Date().toISOString().slice(0, 10);
}

export interface DataOptions {
	backup?: { dir: string; keep: number; hour: number } | undefined;
	publicUrl?: string | undefined;
}

/** Export, import and system information (plan §4, §6.1 Settings). */
export function dataRoutes(
	repos: Repositories,
	conn: DatabaseConnection,
	options: DataOptions = {}
): Hono {
	const app = new Hono();

	/** Everything as JSON (restorable with db:transfer), or items as CSV (re-importable). */
	app.get('/export', async (c) => {
		const format = z.enum(['json', 'csv']).default('json').parse(c.req.query('format'));
		if (format === 'csv') {
			return c.body(await exportItemsCsv(repos), 200, {
				'content-type': 'text/csv; charset=utf-8',
				'content-disposition': `attachment; filename="inventory-items-${stamp()}.csv"`,
				'cache-control': 'no-store'
			});
		}
		return c.body(JSON.stringify(await dumpDatabase(conn)), 200, {
			'content-type': 'application/json',
			'content-disposition': `attachment; filename="inventory-${stamp()}.json"`,
			'cache-control': 'no-store'
		});
	});

	app.get('/import/template', async (c) => {
		const category = z.coerce.number().int().positive().parse(c.req.query('category'));
		return c.body(await importTemplateCsv(repos, category), 200, {
			'content-type': 'text/csv; charset=utf-8',
			'content-disposition': `attachment; filename="import-template-${category}.csv"`
		});
	});

	/** CSV in the request body. Without `commit=true` (or with errors) nothing is written. */
	app.post(
		'/import/items',
		bodyLimit({
			maxSize: 10 * 1024 * 1024,
			onError: (c) =>
				c.json({ error: { code: 'bad_request', message: 'The file is larger than 10 MB' } }, 413)
		}),
		async (c) => {
			const query = importQuerySchema.parse(c.req.query());
			const text = await c.req.text();
			if (!text.trim()) throw new BadRequestError('Send the CSV file as the request body');
			const result = await importItemsCsv(repos, text, {
				defaultCategoryId: query.category,
				updateStock: query.updateStock,
				commit: query.commit
			});
			return c.json(result, query.commit && !result.committed ? 422 : 200);
		}
	);

	app.get('/system', (c) => {
		let lastBackup: { file: string; at: string } | null = null;
		if (options.backup) {
			try {
				const files = readdirSync(options.backup.dir)
					.filter((f) => /^inventory-\d{8}-\d{6}\./.test(f))
					.sort();
				const last = files.at(-1);
				if (last) {
					lastBackup = {
						file: last,
						at: statSync(join(options.backup.dir, last)).mtime.toISOString()
					};
				}
			} catch {
				// Directory not created yet.
			}
		}
		return c.json({
			version: VERSION,
			database: conn.dialect,
			publicUrl: options.publicUrl ?? null,
			backup: options.backup ? { ...options.backup, lastBackup } : null
		});
	});

	return app;
}
