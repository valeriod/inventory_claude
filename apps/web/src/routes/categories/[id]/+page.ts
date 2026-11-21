import { error } from '@sveltejs/kit';
import { api } from '#lib/api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	const categories = await api.categories.list(fetch);
	const category = categories.find((c) => String(c.id) === params.id);
	if (!category) error(404, 'Category not found');
	return { category, categories };
};
