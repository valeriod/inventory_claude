import { api, ApiError } from '#lib/api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, url }) => {
	const [categories, locations] = await Promise.all([
		api.categories.list(fetch),
		api.locations.list(fetch)
	]);
	try {
		return {
			list: await api.items.list(url.searchParams, fetch),
			listError: null,
			categories,
			locations
		};
	} catch (err) {
		// Bad filters (400) are shown inline so the user can fix them.
		if (err instanceof ApiError && err.status === 400) {
			return { list: null, listError: err.message, categories, locations };
		}
		throw err;
	}
};
