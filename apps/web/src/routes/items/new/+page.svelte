<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '#lib/api.js';
	import ItemForm, { type ItemPayload } from '#lib/components/ItemForm.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	async function save(payload: ItemPayload) {
		const item = await api.items.create(payload);
		await goto(resolve('/items/[sku]', { sku: item.sku }));
	}
</script>

<h1 class="mb-4 text-2xl font-bold">New item</h1>
<ItemForm
	categories={data.categories}
	locations={data.locations}
	initialCategoryId={data.initialCategoryId}
	initialBarcode={data.barcode}
	onsave={save}
/>
