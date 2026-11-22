import { api } from '#lib/api.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const [system, labels] = await Promise.all([api.system(fetch), api.labelInfo(fetch)]);
	return { system, labels };
};
