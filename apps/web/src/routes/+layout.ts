import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { api } from '#lib/api.js';
import type { LayoutLoad } from './$types';

// Client-rendered SPA: no server-side rendering, no prerendering (plan §2).
export const ssr = false;
export const prerender = false;

export const load: LayoutLoad = async ({ fetch, url }) => {
	const session = await api.session(fetch);
	if (session.authRequired && !session.authenticated && url.pathname !== '/login') {
		redirect(307, resolve(`/login?next=${encodeURIComponent(url.pathname + url.search)}`));
	}
	return { session };
};
