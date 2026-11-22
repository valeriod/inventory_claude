import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { ApiErrorBody } from '@inventory/shared';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { jsonBody } from './http/validate.ts';

/**
 * Single-user password protection (plan §7). When no password is configured, every request is
 * allowed. Sessions are stateless signed cookies: `<issuedAt>.<hmac>`. The signing key is derived
 * from SESSION_SECRET *and* APP_PASSWORD, so changing the password logs out every device.
 */
export interface AuthConfig {
	password: string | undefined;
	sessionSecret: string | undefined;
	/** Clock in ms; injectable for tests. */
	now?: () => number;
}

export interface SessionResponse {
	authRequired: boolean;
	authenticated: boolean;
}

export const SESSION_COOKIE = 'inv_session';
const SESSION_MAX_AGE_S = 180 * 24 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

const loginSchema = z.strictObject({ password: z.string().min(1).max(1024) });

function sha256(value: string): Buffer {
	return createHash('sha256').update(value).digest();
}

function errorBody(code: ApiErrorBody['error']['code'], message: string): ApiErrorBody {
	return { error: { code, message } };
}

function clientIp(c: Context): string {
	try {
		return getConnInfo(c).remote.address ?? 'unknown';
	} catch {
		return 'unknown'; // e.g. app.request() in tests
	}
}

function isSecure(c: Context): boolean {
	return new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https';
}

export function createAuth(config: AuthConfig) {
	const now = config.now ?? Date.now;
	const required = Boolean(config.password);
	const key =
		required && config.sessionSecret
			? createHmac('sha256', config.sessionSecret).update(`session:${config.password}`).digest()
			: undefined;
	if (required && !key) throw new Error('SESSION_SECRET is required when APP_PASSWORD is set');

	const attempts = new Map<string, number[]>();

	function sign(issuedAt: number): string {
		return createHmac('sha256', key!).update(String(issuedAt)).digest('base64url');
	}

	function isValidSession(c: Context): boolean {
		if (!required) return true;
		const token = getCookie(c, SESSION_COOKIE);
		const match = token && /^(\d{1,15})\.([A-Za-z0-9_-]{43})$/.exec(token);
		if (!match) return false;
		const issuedAt = Number(match[1]);
		const expected = Buffer.from(sign(issuedAt));
		const actual = Buffer.from(match[2]!);
		if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
		const age = now() - issuedAt;
		return age >= 0 && age <= SESSION_MAX_AGE_S * 1000;
	}

	function tooManyAttempts(ip: string): boolean {
		const recent = (attempts.get(ip) ?? []).filter((t) => now() - t < LOGIN_WINDOW_MS);
		attempts.set(ip, recent);
		return recent.length >= LOGIN_MAX_ATTEMPTS;
	}

	const routes = new Hono();

	routes.get('/session', (c) =>
		c.json({ authRequired: required, authenticated: isValidSession(c) } satisfies SessionResponse)
	);

	routes.post('/login', async (c) => {
		if (!required)
			return c.json({ authRequired: false, authenticated: true } satisfies SessionResponse);
		const ip = clientIp(c);
		if (tooManyAttempts(ip)) {
			return c.json(
				errorBody('too_many_requests', 'Too many login attempts; try again later'),
				429
			);
		}
		const { password } = await jsonBody(c, loginSchema);
		// Compare fixed-length digests so timing does not leak the password length.
		if (!timingSafeEqual(sha256(password), sha256(config.password!))) {
			attempts.get(ip)!.push(now());
			return c.json(errorBody('unauthorized', 'Wrong password'), 401);
		}
		attempts.delete(ip);
		setCookie(c, SESSION_COOKIE, `${now()}.${sign(now())}`, {
			httpOnly: true,
			sameSite: 'Strict',
			secure: isSecure(c),
			path: '/',
			maxAge: SESSION_MAX_AGE_S
		});
		return c.json({ authRequired: true, authenticated: true } satisfies SessionResponse);
	});

	routes.post('/logout', (c) => {
		deleteCookie(c, SESSION_COOKIE, { path: '/', secure: isSecure(c) });
		return c.json({ authRequired: required, authenticated: !required } satisfies SessionResponse);
	});

	/** Rejects unauthenticated API requests, except health checks and the auth endpoints. */
	const middleware: MiddlewareHandler = async (c, next) => {
		const path = c.req.path;
		if (!required || path === '/api/health' || path.startsWith('/api/auth/') || isValidSession(c)) {
			return next();
		}
		return c.json(errorBody('unauthorized', 'Log in to continue'), 401);
	};

	return { routes, middleware, isValidSession };
}
