import type { Repositories } from '@inventory/db';
import { createLocationRequestSchema, updateLocationRequestSchema } from '@inventory/shared';
import { Hono } from 'hono';
import { intParam, jsonBody } from '../http/validate.ts';

export function locationRoutes(repos: Repositories): Hono {
	const app = new Hono();

	app.get('/', async (c) => c.json(await repos.locations.list()));

	app.get('/:id', async (c) => c.json(await repos.locations.get(intParam(c, 'id'))));

	app.post('/', async (c) => {
		const input = await jsonBody(c, createLocationRequestSchema);
		return c.json(await repos.locations.create(input), 201);
	});

	app.patch('/:id', async (c) => {
		const id = intParam(c, 'id');
		const patch = await jsonBody(c, updateLocationRequestSchema);
		return c.json(await repos.locations.update(id, patch));
	});

	app.delete('/:id', async (c) => {
		await repos.locations.delete(intParam(c, 'id'));
		return c.body(null, 204);
	});

	return app;
}
