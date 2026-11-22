import { connect } from '@inventory/db';
import type { ApiErrorBody } from '@inventory/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import type { SessionResponse } from './auth.ts';

const SECRET = 's'.repeat(32);

function setup(password: string | undefined, clock = { t: 1_800_000_000_000 }) {
	const conn = connect('sqlite::memory:');
	const app = createApp({ conn, auth: { password, sessionSecret: SECRET, now: () => clock.t } });
	const login = (pw: string) =>
		app.request('/api/auth/login', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ password: pw })
		});
	return { app, login, clock };
}

function cookieFrom(res: Response): string {
	const header = res.headers.get('set-cookie') ?? '';
	return header.split(';')[0]!;
}

describe('auth disabled', () => {
	it('allows all requests and reports no auth required', async () => {
		const { app } = setup(undefined);
		expect((await app.request('/api/units')).status).toBe(200);
		const session = (await (await app.request('/api/auth/session')).json()) as SessionResponse;
		expect(session).toEqual({ authRequired: false, authenticated: true });
	});
});

describe('auth enabled', () => {
	it('protects the API but not health or auth endpoints', async () => {
		const { app } = setup('hunter2');
		const res = await app.request('/api/units');
		expect(res.status).toBe(401);
		expect(((await res.json()) as ApiErrorBody).error.code).toBe('unauthorized');
		expect((await app.request('/api/health')).status).toBe(200);
		expect(await (await app.request('/api/auth/session')).json()).toEqual({
			authRequired: true,
			authenticated: false
		});
	});

	it('logs in with the right password and sets a hardened cookie', async () => {
		const { app, login } = setup('hunter2');
		const res = await login('hunter2');
		expect(res.status).toBe(200);
		const setCookie = res.headers.get('set-cookie') ?? '';
		expect(setCookie).toMatch(/^inv_session=\d+\.[\w-]{43};/);
		expect(setCookie).toMatch(/HttpOnly/);
		expect(setCookie).toMatch(/SameSite=Strict/);
		expect(setCookie).toMatch(/Max-Age=15552000/);

		const cookie = cookieFrom(res);
		expect((await app.request('/api/units', { headers: { cookie } })).status).toBe(200);
		expect(await (await app.request('/api/auth/session', { headers: { cookie } })).json()).toEqual({
			authRequired: true,
			authenticated: true
		});
	});

	it('marks the cookie Secure behind an HTTPS proxy', async () => {
		const { app } = setup('hunter2');
		const res = await app.request('/api/auth/login', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https' },
			body: JSON.stringify({ password: 'hunter2' })
		});
		expect(res.headers.get('set-cookie')).toMatch(/Secure/);
	});

	it('rejects wrong passwords and tampered or expired cookies', async () => {
		const { app, login, clock } = setup('hunter2');
		expect((await login('wrong')).status).toBe(401);

		const cookie = cookieFrom(await login('hunter2'));
		const tampered = cookie.replace(/=(\d+)\./, (_, t: string) => `=${Number(t) + 1}.`);
		expect((await app.request('/api/units', { headers: { cookie: tampered } })).status).toBe(401);

		clock.t += 181 * 24 * 60 * 60 * 1000;
		expect((await app.request('/api/units', { headers: { cookie } })).status).toBe(401);
	});

	it('invalidates sessions when the password changes', async () => {
		const clock = { t: 1_800_000_000_000 };
		const cookie = cookieFrom(await setup('old-password', clock).login('old-password'));
		const { app } = setup('new-password', clock);
		expect((await app.request('/api/units', { headers: { cookie } })).status).toBe(401);
	});

	it('rate-limits repeated failures', async () => {
		const { login } = setup('hunter2');
		for (let i = 0; i < 10; i++) expect((await login('nope')).status).toBe(401);
		const blocked = await login('hunter2');
		expect(blocked.status).toBe(429);
		expect(((await blocked.json()) as ApiErrorBody).error.code).toBe('too_many_requests');
	});

	it('behind a trusted proxy, rate-limits per forwarded client address', async () => {
		const conn = connect('sqlite::memory:');
		const app = createApp({
			conn,
			auth: { password: 'hunter2', sessionSecret: SECRET, trustProxy: true }
		});
		const login = (pw: string, ip: string) =>
			app.request('/api/auth/login', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-forwarded-for': `spoofed, ${ip}` },
				body: JSON.stringify({ password: pw })
			});
		for (let i = 0; i < 10; i++) await login('nope', '203.0.113.9');
		expect((await login('hunter2', '203.0.113.9')).status).toBe(429);
		expect((await login('hunter2', '192.168.1.20')).status).toBe(200);
	});

	it('logs out by clearing the cookie', async () => {
		const { app } = setup('hunter2');
		const res = await app.request('/api/auth/logout', { method: 'POST' });
		expect(res.headers.get('set-cookie')).toMatch(/inv_session=;.*Max-Age=0/);
	});
});
