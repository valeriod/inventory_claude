import type { Repositories } from '@inventory/db';
import {
	createCategoryRequestSchema,
	renameFieldRequestSchema,
	updateCategoryRequestSchema
} from '@inventory/shared';
import { Hono } from 'hono';
import { intParam, jsonBody } from '../http/validate.ts';

export function categoryRoutes(repos: Repositories): Hono {
	const app = new Hono();

	app.get('/', async (c) => c.json(await repos.categories.listWithFields()));

	app.get('/:id', async (c) => c.json(await repos.categories.getWithFields(intParam(c, 'id'))));

	app.post('/', async (c) => {
		const input = await jsonBody(c, createCategoryRequestSchema);
		const created = await repos.categories.create(input);
		return c.json(await repos.categories.getWithFields(created.id), 201);
	});

	app.patch('/:id', async (c) => {
		const id = intParam(c, 'id');
		const patch = await jsonBody(c, updateCategoryRequestSchema);
		await repos.categories.update(id, patch);
		return c.json(await repos.categories.getWithFields(id));
	});

	app.delete('/:id', async (c) => {
		await repos.categories.delete(intParam(c, 'id'));
		return c.body(null, 204);
	});

	app.post('/:id/fields/:key/rename', async (c) => {
		const id = intParam(c, 'id');
		const { newKey } = await jsonBody(c, renameFieldRequestSchema);
		await repos.categories.renameField(id, c.req.param('key'), newKey);
		return c.json(await repos.categories.getWithFields(id));
	});

	return app;
}
