import { error } from '@sveltejs/kit';
import { api, ApiError } from '#lib/api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	try {
		const [item, categories, locations] = await Promise.all([
			api.items.get(params.sku, fetch),
			api.categories.list(fetch),
			api.locations.list(fetch)
		]);
		return { item, categories, locations };
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) error(404, `Item ${params.sku} not found`);
		throw err;
	}
};
