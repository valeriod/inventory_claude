import { createRepositories, seedDemoData, type Repositories } from '@inventory/db';
import { createTestDatabase, type TestDatabase } from '@inventory/db/testing';
import type { Hono } from 'hono';
import { afterEach, beforeEach } from 'vitest';
import { createApp } from './app.ts';

export interface ApiFixture {
	db: TestDatabase;
	app: Hono;
	repos: Repositories;
	send: (
		method: string,
		path: string,
		body?: unknown,
		headers?: Record<string, string>
	) => Promise<Response>;
}

/** Fresh migrated database + app per test; optionally seeded with the demo data. */
export function useApi(options: { seed?: boolean } = {}): () => ApiFixture {
	let fixture: ApiFixture | undefined;
	beforeEach(async () => {
		const db = await createTestDatabase();
		const repos = createRepositories(db);
		if (options.seed) await seedDemoData(repos);
		const app = createApp({ conn: db });
		const send: ApiFixture['send'] = async (method, path, body, headers = {}) =>
			app.request(path, {
				method,
				headers: { 'content-type': 'application/json', ...headers },
				body:
					body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
			});
		fixture = { db, app, repos, send };
	});
	afterEach(async () => {
		await fixture?.db.cleanup();
		fixture = undefined;
	});
	return () => {
		if (!fixture) throw new Error('useApi() fixture used outside a test');
		return fixture;
	};
}

export async function json<T>(res: Response): Promise<T> {
	return (await res.json()) as T;
}
