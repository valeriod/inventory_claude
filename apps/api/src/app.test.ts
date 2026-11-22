import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, type DatabaseConnection } from '@inventory/db';
import { healthResponseSchema } from '@inventory/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';

describe('api', () => {
	let conn: DatabaseConnection;

	beforeAll(() => {
		conn = connect(process.env.TEST_DATABASE_URL ?? 'sqlite::memory:');
	});

	afterAll(async () => {
		await conn?.close();
	});

	it('GET /api/health returns status and dialect', async () => {
		const res = await createApp({ conn }).request('/api/health');
		expect(res.status).toBe(200);
		const body = healthResponseSchema.parse(await res.json());
		expect(body.database).toBe(conn.dialect);
	});

	it('unknown API routes return JSON 404', async () => {
		const res = await createApp({ conn }).request('/api/nope');
		expect(res.status).toBe(404);
		expect(await res.json()).toMatchObject({ error: { code: 'not_found' } });
	});

	describe('with a static directory', () => {
		const dir = mkdtempSync(join(tmpdir(), 'inventory-static-'));
		writeFileSync(join(dir, '200.html'), '<html>spa</html>');
		writeFileSync(join(dir, 'robots.txt'), 'User-agent: *');
		mkdirSync(join(dir, '_app/immutable'), { recursive: true });
		writeFileSync(join(dir, '_app/immutable/app.abc123.js'), 'export {}');
		writeFileSync(join(dir, 'manifest.webmanifest'), '{}');

		it('sends security headers, with a CSP on HTML only', async () => {
			const app = createApp({ conn, staticDir: dir });
			const html = await app.request('/items/RES-0001');
			expect(html.headers.get('x-content-type-options')).toBe('nosniff');
			expect(html.headers.get('x-frame-options')).toBe('DENY');
			expect(html.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
			const json = await app.request('/api/health');
			expect(json.headers.get('x-content-type-options')).toBe('nosniff');
			expect(json.headers.get('content-security-policy')).toBeNull();
		});

		it('rejects oversized API bodies', async () => {
			const res = await createApp({ conn }).request('/api/categories', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'content-length': String(2 * 1024 * 1024) },
				body: 'x'.repeat(2 * 1024 * 1024)
			});
			expect(res.status).toBe(413);
		});

		it('caches hashed build files forever and revalidates everything else', async () => {
			const app = createApp({ conn, staticDir: dir });
			const asset = await app.request('/_app/immutable/app.abc123.js');
			expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
			const shell = await app.request('/items/RES-0001');
			expect(shell.headers.get('cache-control')).toBe('no-cache');
			const manifest = await app.request('/manifest.webmanifest');
			expect(manifest.headers.get('content-type')).toContain('application/manifest+json');
		});

		it('serves static files', async () => {
			const res = await createApp({ conn, staticDir: dir }).request('/robots.txt');
			expect(await res.text()).toBe('User-agent: *');
		});

		it('falls back to the SPA shell for client routes', async () => {
			const res = await createApp({ conn, staticDir: dir }).request('/items/RES-0001');
			expect(res.status).toBe(200);
			expect(await res.text()).toContain('spa');
		});

		it('does not serve the SPA shell for unknown API routes', async () => {
			const res = await createApp({ conn, staticDir: dir }).request('/api/nope');
			expect(res.status).toBe(404);
		});
	});

	it('requires 200.html in the static directory', () => {
		const empty = mkdtempSync(join(tmpdir(), 'inventory-empty-'));
		expect(() => createApp({ conn, staticDir: empty })).toThrow(/200.html/);
	});
});
