import {
	AttributeValidationError,
	ConflictError,
	FieldChangeConflictError,
	InsufficientStockError,
	InvalidOperationError,
	NotFoundError,
	VersionConflictError
} from '@inventory/db';
import type { ApiErrorBody } from '@inventory/shared';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';

/** Thrown by request helpers for malformed input (bad JSON, bad path parameters). */
export class BadRequestError extends Error {}

type Code = ApiErrorBody['error']['code'];

function body(code: Code, message: string, details?: unknown): ApiErrorBody {
	return { error: details === undefined ? { code, message } : { code, message, details } };
}

export function toErrorResponse(err: unknown): {
	status: ContentfulStatusCode;
	body: ApiErrorBody;
} {
	if (err instanceof ZodError) {
		const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
		return { status: 400, body: body('validation', 'Request validation failed', details) };
	}
	if (err instanceof AttributeValidationError) {
		const details = err.issues.map((i) => ({
			path: i.key ? `attributes.${i.key}` : 'attributes',
			message: i.message
		}));
		return { status: 400, body: body('validation', 'Invalid attributes', details) };
	}
	if (err instanceof BadRequestError) {
		return { status: 400, body: body('bad_request', err.message) };
	}
	if (err instanceof NotFoundError) return { status: 404, body: body('not_found', err.message) };
	if (err instanceof VersionConflictError) {
		const { expectedVersion, currentVersion } = err;
		return {
			status: 412,
			body: body('version_conflict', err.message, { expectedVersion, currentVersion })
		};
	}
	if (err instanceof FieldChangeConflictError) {
		return { status: 409, body: body('field_change_conflict', err.message, err.violations) };
	}
	if (err instanceof InsufficientStockError) {
		const { sku, requested, available } = err;
		return {
			status: 409,
			body: body('insufficient_stock', err.message, { sku, requested, available })
		};
	}
	if (err instanceof ConflictError) return { status: 409, body: body('conflict', err.message) };
	if (err instanceof InvalidOperationError) {
		return { status: 422, body: body('invalid_operation', err.message) };
	}
	return { status: 500, body: body('internal', 'Internal server error') };
}

export function handleError(err: unknown, c: Context) {
	const { status, body } = toErrorResponse(err);
	if (status >= 500) console.error(err);
	return c.json(body, status);
}

export function notFound(c: Context) {
	return c.json(body('not_found', `No route for ${c.req.method} ${c.req.path}`), 404);
}
