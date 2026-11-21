import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createRepositories, type DatabaseConnection } from '@inventory/db';
import { UNITS, type HealthResponse } from '@inventory/shared';
import { createAuth, type AuthConfig } from './auth.ts';
import { handleError, notFound } from './http/errors.ts';
import { categoryRoutes } from './routes/categories.ts';
import { itemRoutes } from './routes/items.ts';
import { locationRoutes } from './routes/locations.ts';
import { lookupRoutes } from './routes/lookup.ts';
import { VERSION } from './version.ts';

export interface AppOptions {
	conn: DatabaseConnection;
	/** Directory containing the built PWA (apps/web/build). Omit to serve the API only. */
	staticDir?: string | undefined;
	/** Optional single-user password protection (plan §7). */
	auth?: AuthConfig;
}

export function createApp({ conn, staticDir, auth: authConfig }: AppOptions): Hono {
	const repos = createRepositories(conn);
	const auth = createAuth(authConfig ?? { password: undefined, sessionSecret: undefined });
	const app = new Hono();
	const api = new Hono();

	api.use('*', auth.middleware);
	api.route('/auth', auth.routes);

	api.get('/health', (c) =>
		c.json({ status: 'ok', version: VERSION, database: conn.dialect } satisfies HealthResponse)
	);
	api.get('/units', (c) => c.json(UNITS));
	api.route('/categories', categoryRoutes(repos));
	api.route('/items', itemRoutes(repos));
	api.route('/locations', locationRoutes(repos));
	api.route('/lookup', lookupRoutes(repos));

	api.all('*', notFound);
	api.onError(handleError);

	app.route('/api', api);

	if (staticDir) {
		const fallback = join(staticDir, '200.html');
		if (!existsSync(fallback)) {
			throw new Error(`STATIC_DIR ${staticDir} does not contain 200.html; build the web app first`);
		}
		app.use('*', serveStatic({ root: staticDir, precompressed: true }));
		// SPA fallback: any non-API route that isn't a file is handled client-side.
		app.get('*', serveStatic({ path: fallback, precompressed: true }));
	}

	app.onError(handleError);
	return app;
}
