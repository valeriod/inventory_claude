import type { Context } from 'hono';
import type { z } from 'zod';
import { BadRequestError } from './errors.ts';

/** Parse and validate a JSON request body; ZodErrors become 400 responses via the error handler. */
export async function jsonBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
	let raw: unknown;
	try {
		raw = await c.req.json();
	} catch {
		throw new BadRequestError('Request body must be valid JSON');
	}
	return schema.parse(raw);
}

/** A positive integer path parameter such as :id. */
export function intParam(c: Context, name: string): number {
	const value = c.req.param(name) ?? '';
	if (!/^[1-9]\d{0,15}$/.test(value)) throw new BadRequestError(`Invalid ${name} "${value}"`);
	return Number(value);
}
