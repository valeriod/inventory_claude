import { api } from '#lib/api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => ({
	categories: await api.categories.list(fetch)
});
