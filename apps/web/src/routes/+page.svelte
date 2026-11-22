<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { formatQty } from '#lib/format.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let q = $state('');

	const categoryById = $derived(new Map(data.categories.map((c) => [c.id, c])));

	function search(e: SubmitEvent) {
		e.preventDefault();
		goto(resolve(`/items?q=${encodeURIComponent(q.trim())}`));
	}
</script>

<form class="mb-6 flex gap-2" onsubmit={search} role="search">
	<input
		class="input text-base"
		type="search"
		placeholder="Search items, SKUs, values…"
		bind:value={q}
		aria-label="Search"
	/>
	<button class="btn btn-primary">Search</button>
</form>

<div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
	<a href={resolve('/items')} class="card hover:border-blue-300">
		<p class="text-2xl font-bold">{data.itemCount}</p>
		<p class="text-sm text-slate-600">Items</p>
	</a>
	<a href={resolve('/items?lowStock=true')} class="card hover:border-blue-300">
		<p class="text-2xl font-bold" class:text-amber-600={data.lowStock.total > 0}>
			{data.lowStock.total}
		</p>
		<p class="text-sm text-slate-600">Low stock</p>
	</a>
	<a href={resolve('/categories')} class="card hover:border-blue-300">
		<p class="text-2xl font-bold">{data.categories.length}</p>
		<p class="text-sm text-slate-600">Categories</p>
	</a>
	<a href={resolve('/locations')} class="card hover:border-blue-300">
		<p class="text-2xl font-bold">{data.locations.length}</p>
		<p class="text-sm text-slate-600">Locations</p>
	</a>
</div>

<div class="mb-6 flex flex-wrap gap-2">
	<a class="btn btn-primary" href={resolve('/items/new')}>+ New item</a>
	<a class="btn" href={resolve('/categories/new')}>+ New category</a>
	<a class="btn" href={resolve('/scan')}>Scan</a>
	<a class="btn" href={resolve('/scan?mode=receive')}>Receive stock</a>
	<a class="btn" href={resolve('/reports')}>Reports</a>
</div>

<section class="card mb-6">
	<div class="mb-3 flex items-center justify-between gap-2">
		<h2 class="font-semibold">Active projects</h2>
		<a class="link text-sm" href={resolve('/projects')}>All projects</a>
	</div>
	{#if data.projects.length === 0}
		<p class="text-sm text-slate-500">No active projects.</p>
	{:else}
		<ul class="divide-y divide-slate-100">
			{#each data.projects as p (p.id)}
				<li class="flex items-center justify-between gap-3 py-2">
					<a class="link min-w-0 truncate" href={resolve('/projects/[id]', { id: String(p.id) })}>
						{p.name}
					</a>
					<span class="shrink-0 text-sm text-slate-600">
						{p.openLines} reserved
						{#if p.shortLines > 0}<span class="font-medium text-red-700">
								· {p.shortLines} short
							</span>{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="card">
	<h2 class="mb-3 font-semibold">Low stock</h2>
	{#if data.lowStock.items.length === 0}
		<p class="text-sm text-slate-500">Nothing is below its reorder level.</p>
	{:else}
		<ul class="divide-y divide-slate-100">
			{#each data.lowStock.items as item (item.sku)}
				{@const category = categoryById.get(item.categoryId)}
				<li class="flex items-center justify-between gap-3 py-2">
					<a class="link min-w-0 truncate" href={resolve('/items/[sku]', { sku: item.sku })}>
						{item.name}
					</a>
					<span class="shrink-0 text-sm text-amber-700">
						{formatQty(item.qtyAvailable, category)} available
						{#if item.qtyMin !== null}<span class="text-slate-500">
								/ min {formatQty(item.qtyMin, category)}
							</span>{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<p class="mt-6 text-center text-sm print:hidden">
	<a class="link" href={resolve('/sync')}>Offline & sync</a>
</p>
