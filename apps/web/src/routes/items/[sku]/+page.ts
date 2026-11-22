import { error } from '@sveltejs/kit';
import { api, ApiError } from '#lib/api.js';
import { OPEN_PROJECT_STATUSES } from '#lib/format.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	try {
		const [item, categories, locations, movements, reservations, openProjects] = await Promise.all([
			api.items.get(params.sku, fetch),
			api.categories.list(fetch),
			api.locations.list(fetch),
			api.items.movements(params.sku, 25, fetch),
			api.items.reservations(params.sku, fetch),
			api.projects.list([...OPEN_PROJECT_STATUSES], fetch)
		]);
		const category = categories.find((c) => c.id === item.categoryId)!;
		return { item, category, categories, locations, movements, reservations, openProjects };
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) error(404, `Item ${params.sku} not found`);
		throw err;
	}
};
