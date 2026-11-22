import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

/** Short link printed in project QR labels (plan §5). */
export const load: PageLoad = ({ params }) => {
	redirect(307, resolve('/projects/[id]', { id: params.id }));
};
