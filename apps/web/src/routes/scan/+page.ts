import { api } from '#lib/api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, url }) => {
	const projectId = Number(url.searchParams.get('project'));
	const picking =
		url.searchParams.get('mode') === 'pick' && Number.isSafeInteger(projectId) && projectId > 0;
	const [categories, project, lines] = await Promise.all([
		api.categories.list(fetch),
		picking ? api.projects.get(projectId, fetch) : null,
		picking ? api.projects.lines(projectId, fetch) : null
	]);
	return { categories, project, lines };
};
