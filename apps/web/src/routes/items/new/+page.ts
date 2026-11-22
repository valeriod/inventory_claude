import { api } from '#lib/api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, url }) => {
	const [categories, locations] = await Promise.all([
		api.categories.list(fetch),
		api.locations.list(fetch)
	]);
	const category = Number(url.searchParams.get('category'));
	return {
		categories,
		locations,
		initialCategoryId: categories.some((c) => c.id === category) ? category : undefined,
		barcode: url.searchParams.get('barcode') ?? undefined
	};
};
