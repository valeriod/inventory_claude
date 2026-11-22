import { error } from '@sveltejs/kit';
import { api, ApiError } from '#lib/api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ params, fetch }) => {
	const id = Number(params.id);
	if (!Number.isSafeInteger(id) || id <= 0) error(404, 'Project not found');
	try {
		const [project, lines, categories, locations] = await Promise.all([
			api.projects.get(id, fetch),
			api.projects.lines(id, fetch),
			api.categories.list(fetch),
			api.locations.list(fetch)
		]);
		return { project, lines, categories, locations };
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) error(404, 'Project not found');
		throw err;
	}
};
