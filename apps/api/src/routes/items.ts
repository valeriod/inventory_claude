import type { Repositories } from '@inventory/db';
import {
	createItemRequestSchema,
	stockCountRequestSchema,
	stockMovementRequestSchema,
	updateItemRequestSchema,
	type Attributes,
	type ItemListResponse,
	type ItemWithAvailability
} from '@inventory/shared';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { BadRequestError } from '../http/errors.ts';
import { parseItemQuery } from '../http/item-query.ts';
import { jsonBody } from '../http/validate.ts';

const pagingSchema = z.object({
	limit: z.coerce.number().int().min(1).max(500).default(100),
	offset: z.coerce.number().int().min(0).default(0)
});

function etag(item: ItemWithAvailability): string {
	return `"${item.version}"`;
}

/** Parse an If-Match header (`"3"`, `W/"3"` or `3`); undefined when absent or `*`. */
function ifMatchVersion(c: Context): number | undefined {
	const header = c.req.header('if-match')?.trim();
	if (!header || header === '*') return undefined;
	const match = /^(?:W\/)?"?(\d{1,15})"?$/.exec(header);
	if (!match) throw new BadRequestError(`Invalid If-Match header "${header}"`);
	return Number(match[1]);
}

function withEtag(c: Context, item: ItemWithAvailability, status: 200 | 201 = 200) {
	c.header('ETag', etag(item));
	return c.json(item, status);
}

export function itemRoutes(repos: Repositories): Hono {
	const app = new Hono();

	app.get('/', async (c) => {
		const { filter, page, pageSize } = await parseItemQuery(repos, new URL(c.req.url).searchParams);
		const { items, total } = await repos.items.list(filter);
		return c.json({ items, total, page, pageSize } satisfies ItemListResponse);
	});

	app.post('/', async (c) => {
		const input = await jsonBody(c, createItemRequestSchema);
		const item = await repos.items.create({
			...input,
			attributes: input.attributes as Attributes | undefined
		});
		c.header('Location', `/api/items/${encodeURIComponent(item.sku)}`);
		return withEtag(c, item, 201);
	});

	app.get('/:sku', async (c) => withEtag(c, await repos.items.get(c.req.param('sku'))));

	app.patch('/:sku', async (c) => {
		const sku = c.req.param('sku');
		const expected = ifMatchVersion(c);
		const patch = await jsonBody(c, updateItemRequestSchema);
		const current = await repos.items.get(sku);
		const { attributes, ...rest } = patch;
		const item = await repos.items.update(
			sku,
			{
				...rest,
				...(attributes !== undefined && {
					attributes: { ...current.attributes, ...(attributes as Attributes) }
				})
			},
			// Merging attributes reads the current item, so always guard against interleaved edits.
			expected ?? current.version
		);
		return withEtag(c, item);
	});

	/** Archive by default; `?permanent=true` hard-deletes items without history. */
	app.delete('/:sku', async (c) => {
		const sku = c.req.param('sku');
		if (c.req.query('permanent') === 'true') {
			await repos.items.delete(sku);
			return c.body(null, 204);
		}
		return withEtag(c, await repos.items.archive(sku));
	});

	app.post('/:sku/restore', async (c) =>
		withEtag(c, await repos.items.restore(c.req.param('sku')))
	);

	app.get('/:sku/movements', async (c) => {
		const sku = c.req.param('sku');
		await repos.items.get(sku); // 404 for unknown SKUs
		const { limit, offset } = pagingSchema.parse(c.req.query());
		return c.json(await repos.stock.movements({ sku, limit, offset }));
	});

	app.post('/:sku/movements', async (c) => {
		const input = await jsonBody(c, stockMovementRequestSchema);
		const key = idempotencyKey(c);
		const { result, replayed } = await repos.stock.adjustOnce(
			{ ...input, sku: c.req.param('sku') },
			key && `movement:${key}`
		);
		if (replayed) c.header('idempotent-replay', 'true');
		return c.json(result, 201);
	});

	app.post('/:sku/count', async (c) => {
		const input = await jsonBody(c, stockCountRequestSchema);
		const key = idempotencyKey(c);
		const { result, replayed } = await repos.stock.countOnce(
			{ ...input, sku: c.req.param('sku') },
			key && `count:${key}`
		);
		if (replayed) c.header('idempotent-replay', 'true');
		return c.json(result);
	});

	app.get('/:sku/reservations', async (c) => {
		const sku = c.req.param('sku');
		await repos.items.get(sku);
		return c.json(await repos.reservations.listBySkuWithProject(sku));
	});

	return app;
}

/**
 * Optional `Idempotency-Key` header (the PWA sends one with stock changes it queued offline), so
 * a replayed request is applied once.
 */
function idempotencyKey(c: Context): string | undefined {
	const key = c.req.header('idempotency-key');
	if (key === undefined) return undefined;
	if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) {
		throw new BadRequestError('Idempotency-Key must be 8–64 letters, digits, "-" or "_"');
	}
	return key;
}
