import { InvalidOperationError, type Repositories } from '@inventory/db';
import {
	createProjectRequestSchema,
	listProjectsQuerySchema,
	reserveRequestSchema,
	updateProjectRequestSchema,
	updateReservationRequestSchema
} from '@inventory/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { intParam, jsonBody } from '../http/validate.ts';

const consumeAllSchema = z.strictObject({
	note: z.string().trim().max(1000).nullable().optional()
});

/** /api/projects (plan §4). */
export function projectRoutes(repos: Repositories): Hono {
	const app = new Hono();

	app.get('/', async (c) => {
		const { status } = listProjectsQuerySchema.parse(c.req.query());
		return c.json(await repos.projects.listWithSummary({ status }));
	});

	app.get('/:id', async (c) => c.json(await repos.projects.getWithSummary(intParam(c, 'id'))));

	app.post('/', async (c) => {
		const input = await jsonBody(c, createProjectRequestSchema);
		const project = await repos.projects.create(input);
		return c.json(await repos.projects.getWithSummary(project.id), 201);
	});

	app.patch('/:id', async (c) => {
		const id = intParam(c, 'id');
		await repos.projects.update(id, await jsonBody(c, updateProjectRequestSchema));
		return c.json(await repos.projects.getWithSummary(id));
	});

	/** Deletes the project and its reservations (open ones return to stock). */
	app.delete('/:id', async (c) => {
		await repos.projects.delete(intParam(c, 'id'));
		return c.body(null, 204);
	});

	/** Pick list: all reservation lines with item stock and shortages. */
	app.get('/:id/reservations', async (c) =>
		c.json(await repos.reservations.pickList(intParam(c, 'id')))
	);

	app.post('/:id/reservations', async (c) => {
		const projectId = intParam(c, 'id');
		const input = await jsonBody(c, reserveRequestSchema);
		const item = await repos.items.get(input.sku);
		if (item.archivedAt) throw new InvalidOperationError(`Item ${item.sku} is archived`);
		const reservation = await repos.reservations.reserve({ projectId, ...input });
		return c.json(reservation, 201);
	});

	app.post('/:id/consume-all', async (c) => {
		const projectId = intParam(c, 'id');
		const hasBody = (c.req.header('content-length') ?? '0') !== '0';
		const { note } = hasBody ? await jsonBody(c, consumeAllSchema) : { note: undefined };
		const consumed = await repos.reservations.consumeAll(projectId, note);
		return c.json({ consumed: consumed.length });
	});

	app.post('/:id/release-all', async (c) => {
		const released = await repos.reservations.releaseAll(intParam(c, 'id'));
		return c.json({ released });
	});

	return app;
}

/** /api/reservations/:id — change quantity, consume (fully or partly) or release. */
export function reservationRoutes(repos: Repositories): Hono {
	const app = new Hono();

	app.get('/:id', async (c) => c.json(await repos.reservations.get(intParam(c, 'id'))));

	app.patch('/:id', async (c) => {
		const id = intParam(c, 'id');
		const body = await jsonBody(c, updateReservationRequestSchema);
		if (!('status' in body)) return c.json(await repos.reservations.updateQty(id, body.qty));
		if (body.status === 'released') return c.json(await repos.reservations.release(id));
		return c.json(await repos.reservations.consume(id, { qty: body.qty, note: body.note }));
	});

	return app;
}
