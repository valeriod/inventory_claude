<script lang="ts">
	import type { ItemWithAvailability } from '@inventory/shared';
	import { api } from '#lib/api.js';

	/** Search box that finds items by name, SKU or attribute values and reports the one chosen. */
	let {
		onselect,
		id,
		placeholder = 'Search items or type a SKU…'
	}: {
		onselect: (item: ItemWithAvailability) => void;
		id?: string;
		placeholder?: string;
	} = $props();

	let q = $state('');
	let results = $state<ItemWithAvailability[]>([]);
	let searching = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let seq = 0;

	function search() {
		clearTimeout(timer);
		const term = q.trim();
		if (!term) {
			results = [];
			return;
		}
		timer = setTimeout(async () => {
			const mine = ++seq;
			searching = true;
			try {
				const params = new URLSearchParams({ q: term, pageSize: '8' });
				const list = await api.items.list(params);
				if (mine === seq) results = list.items;
			} catch {
				if (mine === seq) results = [];
			} finally {
				if (mine === seq) searching = false;
			}
		}, 200);
	}

	function choose(item: ItemWithAvailability) {
		onselect(item);
		q = '';
		results = [];
	}
</script>

<div class="relative">
	<input
		{id}
		class="input"
		type="search"
		autocomplete="off"
		{placeholder}
		bind:value={q}
		oninput={search}
		aria-label="Find an item"
	/>
	{#if q.trim() && (results.length > 0 || !searching)}
		<ul
			class="absolute inset-x-0 z-20 mt-1 max-h-72 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg"
			aria-label="Matching items"
		>
			{#each results as item (item.sku)}
				<li>
					<button
						type="button"
						class="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
						onclick={() => choose(item)}
					>
						<span class="font-medium">{item.name}</span>
						<span class="font-mono text-xs text-slate-500">{item.sku}</span>
					</button>
				</li>
			{:else}
				<li class="px-3 py-2 text-sm text-slate-500">No matching items.</li>
			{/each}
		</ul>
	{/if}
</div>
