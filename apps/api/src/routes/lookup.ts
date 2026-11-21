import { NotFoundError, type Repositories } from '@inventory/db';
import type { LookupResult } from '@inventory/shared';
import { Hono } from 'hono';
import { BadRequestError } from '../http/errors.ts';

/**
 * Our printed QR labels encode URLs: /i/<sku>, /l/<location code>, /p/<project id>
 * (plan §5). Accepts absolute URLs or bare paths.
 */
export function parseLabelUrl(code: string): { kind: 'i' | 'l' | 'p'; value: string } | null {
	let path: string;
	if (/^https?:\/\//i.test(code)) {
		try {
			path = new URL(code).pathname;
		} catch {
			return null;
		}
	} else if (code.startsWith('/')) {
		path = code.split(/[?#]/)[0]!;
	} else {
		return null;
	}
	const match = /\/(i|l|p)\/([^/]+)\/?$/.exec(path);
	if (!match) return null;
	try {
		return { kind: match[1] as 'i' | 'l' | 'p', value: decodeURIComponent(match[2]!) };
	} catch {
		return null;
	}
}

async function resolve(repos: Repositories, code: string): Promise<LookupResult> {
	const label = parseLabelUrl(code);
	if (label) {
		switch (label.kind) {
			case 'i':
				return { type: 'item', item: await repos.items.get(label.value) };
			case 'l': {
				const location = await repos.locations.findByCode(label.value);
				if (!location) throw new NotFoundError('Location', label.value);
				return { type: 'location', location };
			}
			case 'p': {
				const id = Number(label.value);
				if (!Number.isSafeInteger(id) || id <= 0) throw new NotFoundError('Project', label.value);
				return { type: 'project', project: await repos.projects.get(id) };
			}
		}
	}

	const item = (await repos.items.find(code)) ?? (await repos.items.findByBarcode(code));
	if (item) return { type: 'item', item };
	const location = await repos.locations.findByCode(code);
	if (location) return { type: 'location', location };
	throw new NotFoundError('Code', code);
}

/** GET /api/lookup?code=… — resolve a scanned barcode or QR code (plan §5). */
export function lookupRoutes(repos: Repositories): Hono {
	const app = new Hono();
	app.get('/', async (c) => {
		const code = c.req.query('code')?.trim();
		if (!code) throw new BadRequestError('Missing "code" query parameter');
		if (code.length > 2048) throw new BadRequestError('Code is too long');
		return c.json(await resolve(repos, code));
	});
	return app;
}
