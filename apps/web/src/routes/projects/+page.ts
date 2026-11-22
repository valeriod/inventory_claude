import { api } from '#lib/api.js';
import type { PageLoad } from './$types';

export const FILTERS = {
	open: ['planning', 'active'],
	completed: ['completed'],
	cancelled: ['cancelled'],
	all: []
} as const;
export type ProjectFilter = keyof typeof FILTERS;

export const load: PageLoad = async ({ fetch, url }) => {
	const param = url.searchParams.get('show');
	const filter: ProjectFilter = param && param in FILTERS ? (param as ProjectFilter) : 'open';
	return { filter, projects: await api.projects.list([...FILTERS[filter]], fetch) };
};
