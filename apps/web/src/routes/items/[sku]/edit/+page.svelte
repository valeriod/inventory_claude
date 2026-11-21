<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '#lib/api.js';
	import ItemForm, { type ItemPayload } from '#lib/components/ItemForm.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	async function save(payload: ItemPayload) {
		const { categoryId, name, description, barcode, locationId, qtyMin, attributes } = payload;
		await api.items.update(
			data.item.sku,
			{ categoryId, name, description, barcode, locationId, qtyMin, attributes },
			data.item.version
		);
		await goto(resolve('/items/[sku]', { sku: data.item.sku }));
	}
</script>

<h1 class="mb-1 text-2xl font-bold">Edit {data.item.name}</h1>
<p class="mb-4 font-mono text-sm text-slate-500">{data.item.sku}</p>
{#key data.item.version}
	<ItemForm
		item={data.item}
		categories={data.categories}
		locations={data.locations}
		onsave={save}
	/>
{/key}
