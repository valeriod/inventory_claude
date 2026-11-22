import { NotFoundError, type Repositories } from '@inventory/db';
import { labelLayout, labelsQuerySchema, type Location } from '@inventory/shared';
import { Hono } from 'hono';
import { renderLabelsPdf, type Label } from '../labels/pdf.ts';

export interface LabelOptions {
	/** Base URL encoded in the QR codes (PUBLIC_URL). Falls back to the request's origin. */
	publicUrl?: string | undefined;
}

function locationPath(location: Location, byId: Map<number, Location>): string {
	const names = [location.name];
	let parent = location.parentId === null ? undefined : byId.get(location.parentId);
	while (parent && names.length < 4) {
		names.unshift(parent.name);
		parent = parent.parentId === null ? undefined : byId.get(parent.parentId);
	}
	return names.join(' › ');
}

/** GET /api/labels — printable QR labels for items and bins (plan §4, §5). */
export function labelRoutes(repos: Repositories, options: LabelOptions = {}): Hono {
	const app = new Hono();
	const baseUrl = (requestUrl: string) =>
		(options.publicUrl ?? new URL(requestUrl).origin).replace(/\/+$/, '');

	/** Where the QR codes will point, so the UI can warn when PUBLIC_URL is not set. */
	app.get('/info', (c) =>
		c.json({ baseUrl: baseUrl(c.req.url), configured: options.publicUrl !== undefined })
	);

	app.get('/', async (c) => {
		const query = labelsQuerySchema.parse(c.req.query());
		const base = baseUrl(c.req.url);
		const locations = await repos.locations.list();
		const byId = new Map(locations.map((l) => [l.id, l]));
		const byCode = new Map(locations.map((l) => [l.code, l]));

		const labels: Label[] = [];
		const missing: string[] = [];
		for (const sku of query.skus) {
			const item = await repos.items.find(sku);
			if (!item) {
				missing.push(sku);
				continue;
			}
			const location = item.locationId === null ? undefined : byId.get(item.locationId);
			labels.push({
				url: `${base}/i/${encodeURIComponent(item.sku)}`,
				title: item.sku,
				name: item.name,
				footer: location?.code
			});
		}
		for (const code of query.locations) {
			const location = byCode.get(code);
			if (!location) {
				missing.push(code);
				continue;
			}
			labels.push({
				url: `${base}/l/${encodeURIComponent(location.code)}`,
				title: location.code,
				name: locationPath(location, byId),
				footer: location.description ?? undefined
			});
		}
		if (missing.length > 0) throw new NotFoundError('Label code', missing.join(', '));

		const pdf = await renderLabelsPdf(labels, {
			layout: labelLayout(query.layout)!,
			skip: query.skip,
			outline: query.outline
		});
		return c.body(new Uint8Array(pdf), 200, {
			'content-type': 'application/pdf',
			'content-disposition': 'inline; filename="labels.pdf"',
			'cache-control': 'no-store'
		});
	});
	return app;
}
