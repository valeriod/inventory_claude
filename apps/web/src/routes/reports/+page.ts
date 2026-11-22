import { api, ApiError } from '#lib/api.js';
import { reportKind, toApiQuery } from '#lib/report-query.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, url }) => {
	const kind = reportKind(url.searchParams);
	const query = toApiQuery(url.searchParams);
	const [categories, locations, projects] = await Promise.all([
		api.categories.list(fetch),
		api.locations.list(fetch),
		api.projects.list([], fetch)
	]);
	const needsProject = kind === 'project' && !query.get('project');
	let report = null;
	let reportError: string | null = null;
	if (!needsProject) {
		try {
			report = await api.reports.get(kind, query, fetch);
		} catch (err) {
			// Bad filters (400) or a deleted project (404) are shown inline.
			if (err instanceof ApiError && (err.status === 400 || err.status === 404)) {
				reportError = err.message;
			} else throw err;
		}
	}
	return { kind, categories, locations, projects, report, reportError };
};
