import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';

/**
 * Content-Security-Policy for the app's HTML. 'unsafe-inline' scripts are needed for SvelteKit's
 * inline bootstrap in the SPA shell, 'wasm-unsafe-eval' for the zxing barcode decoder. Everything
 * else is same-origin only.
 */
export const CONTENT_SECURITY_POLICY = [
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
	"font-src 'self'",
	"connect-src 'self'",
	"worker-src 'self' blob:",
	"manifest-src 'self'",
	"frame-ancestors 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"object-src 'none'"
].join('; ');

/** Security headers on every response; the CSP only on HTML (it would break the PDF viewer). */
export const securityHeaders: MiddlewareHandler = async (c, next) => {
	await next();
	c.header('x-content-type-options', 'nosniff');
	c.header('referrer-policy', 'same-origin');
	c.header('x-frame-options', 'DENY');
	c.header('permissions-policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
	c.header('cross-origin-opener-policy', 'same-origin');
	if (c.res.headers.get('content-type')?.startsWith('text/html')) {
		c.header('content-security-policy', CONTENT_SECURITY_POLICY);
	}
};

/** JSON bodies are small; the CSV import has its own, larger limit. */
export const apiBodyLimit: MiddlewareHandler = (c, next) =>
	c.req.path === '/api/import/items'
		? next()
		: bodyLimit({
				maxSize: 1024 * 1024,
				onError: (ctx) =>
					ctx.json({ error: { code: 'bad_request', message: 'Request body is too large' } }, 413)
			})(c, next);
