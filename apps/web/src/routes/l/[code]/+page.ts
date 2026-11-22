import { error, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { api, ApiError } from '#lib/api.js';
import type { PageLoad } from './$types';

/** Short link printed in bin QR labels: shows the items stored there (plan §5). */
export const load: PageLoad = async ({ params, fetch }) => {
	let result;
	try {
		result = await api.lookup(`/l/${encodeURIComponent(params.code)}`, fetch);
	} catch (err) {
		if (err instanceof ApiError && err.status === 404)
			error(404, `Location ${params.code} not found`);
		throw err;
	}
	if (result.type !== 'location') error(404, `Location ${params.code} not found`);
	redirect(307, resolve(`/items?location=${result.location.id}`));
};
