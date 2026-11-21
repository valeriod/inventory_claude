<script lang="ts">
	import type { CreateCategoryRequest } from '@inventory/shared';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '#lib/api.js';
	import CategoryForm from '#lib/components/CategoryForm.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	async function save(payload: Required<CreateCategoryRequest>) {
		const created = await api.categories.create(payload);
		await goto(resolve('/categories/[id]', { id: String(created.id) }));
	}
</script>

<h1 class="mb-4 text-2xl font-bold">New category</h1>
<CategoryForm categories={data.categories} onsave={save} />
