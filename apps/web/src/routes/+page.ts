import { api } from '#lib/api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const [lowStock, all, categories, locations] = await Promise.all([
		api.items.list('lowStock=true&pageSize=10&sort=name', fetch),
		api.items.list('pageSize=1', fetch),
		api.categories.list(fetch),
		api.locations.list(fetch)
	]);
	return { lowStock, itemCount: all.total, categories, locations };
};
