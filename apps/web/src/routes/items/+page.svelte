<script lang="ts">
	import { parseSi, type FieldDef } from '@inventory/shared';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { SvelteSet } from 'svelte/reactivity';
	import LabelDialog from '#lib/components/LabelDialog.svelte';
	import Pagination from '#lib/components/Pagination.svelte';
	import TreeSelect from '#lib/components/TreeSelect.svelte';
	import { formatAttribute, formatQty } from '#lib/format.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const params = $derived(page.url.searchParams);
	const categoryId = $derived(params.get('category') ? Number(params.get('category')) : null);
	const locationId = $derived(params.get('location') ? Number(params.get('location')) : null);
	const category = $derived(data.categories.find((c) => c.id === categoryId));
	const filterDefs = $derived(category?.resolvedFieldDefs.filter((d) => d.filterable) ?? []);
	const listDefs = $derived(category?.resolvedFieldDefs.filter((d) => d.showInList) ?? []);
	const categoryById = $derived(new Map(data.categories.map((c) => [c.id, c])));
	const locationById = $derived(new Map(data.locations.map((l) => [l.id, l])));

	// svelte-ignore state_referenced_locally
	let q = $state(params.get('q') ?? '');
	let debounce: ReturnType<typeof setTimeout> | undefined;

	function navigate(update: (p: URLSearchParams) => void) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- temporary copy used to build a URL
		const next = new URLSearchParams(page.url.searchParams.toString());
		update(next);
		next.delete('page');
		goto(resolve(`/items?${next}`), { replace: true, reset: false });
	}

	function setParam(name: string, value: string | null | undefined) {
		navigate((p) => (value ? p.set(name, value) : p.delete(name)));
	}

	function onSearch() {
		clearTimeout(debounce);
		debounce = setTimeout(() => setParam('q', q.trim()), 300);
	}

	function onCategory(id: number | null) {
		navigate((p) => {
			for (const key of [...p.keys()]) if (key.startsWith('attr.')) p.delete(key);
			if (id === null) p.delete('category');
			else p.set('category', String(id));
		});
	}

	/** Numeric filter input: quantity fields accept SI notation ("1k"). */
	function setNumeric(def: FieldDef, op: 'gte' | 'lte', text: string) {
		const name = `attr.${def.key}[${op}]`;
		const t = text.trim();
		if (!t) return setParam(name, null);
		try {
			const value = def.type === 'quantity' ? parseSi(t, def.unit) : Number(t.replace(',', '.'));
			if (Number.isFinite(value)) setParam(name, String(value));
		} catch {
			/* keep the previous filter until the input is readable */
		}
	}

	function pageHref(n: number) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- temporary copy used to build a URL
		const next = new URLSearchParams(page.url.searchParams.toString());
		next.set('page', String(n));
		return resolve(`/items?${next}`);
	}

	/** Selected SKUs (kept across pages and filter changes) for printing labels. */
	const selected = new SvelteSet<string>();
	let labelOpen = $state(false);
	const pageSkus = $derived(data.list?.items.map((i) => i.sku) ?? []);
	const allOnPageSelected = $derived(
		pageSkus.length > 0 && pageSkus.every((sku) => selected.has(sku))
	);

	function toggleAllOnPage() {
		const select = !allOnPageSelected;
		for (const sku of pageSkus) {
			if (select) selected.add(sku);
			else selected.delete(sku);
		}
	}

	function toggle(sku: string) {
		if (selected.has(sku)) selected.delete(sku);
		else selected.add(sku);
	}

	const activeFilters = $derived(
		[...params.keys()].filter((k) => k !== 'page' && k !== 'sort' && k !== 'dir').length
	);
</script>

<div class="mb-4 flex flex-wrap items-center justify-between gap-2">
	<h1 class="text-2xl font-bold">Items</h1>
	<a
		class="btn btn-primary"
		href={categoryId ? resolve(`/items/new?category=${categoryId}`) : resolve('/items/new')}
	>
		+ New item
	</a>
</div>

<section class="card mb-4 space-y-3">
	<input
		class="input text-base"
		type="search"
		placeholder="Search…"
		bind:value={q}
		oninput={onSearch}
		aria-label="Search"
	/>
	<div class="grid gap-3 sm:grid-cols-4">
		<div>
			<label class="label" for="f-category">Category</label>
			<TreeSelect
				id="f-category"
				nodes={data.categories}
				value={categoryId}
				placeholder="All categories"
				onchange={onCategory}
			/>
		</div>
		<div>
			<label class="label" for="f-location">Location</label>
			<TreeSelect
				id="f-location"
				nodes={data.locations}
				value={locationId}
				placeholder="All locations"
				onchange={(id) => setParam('location', id === null ? null : String(id))}
			/>
		</div>
		<div>
			<label class="label" for="f-sort">Sort by</label>
			<div class="flex gap-1">
				<select
					id="f-sort"
					class="input"
					value={params.get('sort') ?? 'name'}
					onchange={(e) => setParam('sort', e.currentTarget.value)}
				>
					<option value="name">Name</option>
					<option value="sku">SKU</option>
					<option value="qty">Quantity</option>
					<option value="updated">Last change</option>
				</select>
				<button
					class="btn"
					aria-label="Toggle sort direction"
					onclick={() => setParam('dir', params.get('dir') === 'desc' ? 'asc' : 'desc')}
				>
					{params.get('dir') === 'desc' ? '↓' : '↑'}
				</button>
			</div>
		</div>
		<div class="flex flex-col justify-end gap-1 text-sm">
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					checked={params.get('lowStock') === 'true'}
					onchange={(e) => setParam('lowStock', e.currentTarget.checked ? 'true' : null)}
				/>
				Low stock only
			</label>
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					checked={params.get('includeArchived') === 'true'}
					onchange={(e) => setParam('includeArchived', e.currentTarget.checked ? 'true' : null)}
				/>
				Include archived
			</label>
		</div>
	</div>

	{#if filterDefs.length}
		<div class="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-4">
			{#each filterDefs as def (def.key)}
				<div>
					<label class="label" for="af-{def.key}">{def.label}</label>
					{#if def.type === 'enum' || def.type === 'multi_enum'}
						{@const name =
							def.type === 'multi_enum' ? `attr.${def.key}[contains]` : `attr.${def.key}`}
						<select
							id="af-{def.key}"
							class="input"
							value={params.get(name) ?? ''}
							onchange={(e) => setParam(name, e.currentTarget.value)}
						>
							<option value="">Any</option>
							{#each def.options as option (option)}<option value={option}>{option}</option>{/each}
						</select>
					{:else if def.type === 'boolean'}
						<select
							id="af-{def.key}"
							class="input"
							value={params.get(`attr.${def.key}`) ?? ''}
							onchange={(e) => setParam(`attr.${def.key}`, e.currentTarget.value)}
						>
							<option value="">Any</option>
							<option value="true">Yes</option>
							<option value="false">No</option>
						</select>
					{:else if def.type === 'number' || def.type === 'quantity'}
						<div class="flex gap-1">
							<input
								id="af-{def.key}"
								class="input"
								placeholder="min"
								value={params.get(`attr.${def.key}[gte]`) ?? ''}
								onchange={(e) => setNumeric(def, 'gte', e.currentTarget.value)}
							/>
							<input
								class="input"
								placeholder="max"
								aria-label="{def.label} maximum"
								value={params.get(`attr.${def.key}[lte]`) ?? ''}
								onchange={(e) => setNumeric(def, 'lte', e.currentTarget.value)}
							/>
						</div>
					{:else}
						<input
							id="af-{def.key}"
							class="input"
							value={params.get(`attr.${def.key}`) ?? ''}
							onchange={(e) => setParam(`attr.${def.key}`, e.currentTarget.value.trim())}
						/>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
	{#if activeFilters}
		<a class="link text-sm" href={resolve('/items')}>Clear filters</a>
	{/if}
</section>

{#if data.listError}
	<div role="alert" class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
		{data.listError}
	</div>
{:else if data.list}
	{#if data.list.items.length === 0}
		<p class="card text-center text-slate-500">No items found.</p>
	{:else}
		<div class="card overflow-x-auto p-0">
			<table class="w-full text-left text-sm">
				<thead class="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
					<tr>
						<th class="w-8 py-2 pl-3">
							<input
								type="checkbox"
								aria-label="Select all items on this page"
								checked={allOnPageSelected}
								onchange={toggleAllOnPage}
							/>
						</th>
						<th class="px-3 py-2">Item</th>
						<th class="hidden px-3 py-2 md:table-cell">Category</th>
						<th class="hidden px-3 py-2 md:table-cell">Location</th>
						{#each listDefs as def (def.key)}<th class="hidden px-3 py-2 lg:table-cell">
								{def.label}
							</th>{/each}
						<th class="px-3 py-2 text-right">On hand</th>
						<th class="hidden px-3 py-2 text-right sm:table-cell">Available</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each data.list.items as item (item.sku)}
						{@const cat = categoryById.get(item.categoryId)}
						{@const low = item.qtyMin !== null && item.qtyAvailable <= item.qtyMin}
						<tr class="hover:bg-slate-50" class:opacity-60={item.archivedAt}>
							<td class="py-2 pl-3">
								<input
									type="checkbox"
									aria-label="Select {item.sku}"
									checked={selected.has(item.sku)}
									onchange={() => toggle(item.sku)}
								/>
							</td>
							<td class="px-3 py-2">
								<a class="link font-medium" href={resolve('/items/[sku]', { sku: item.sku })}>
									{item.name}
								</a>
								<div class="font-mono text-xs text-slate-500">
									{item.sku}{#if item.archivedAt}
										· archived{/if}
								</div>
							</td>
							<td class="hidden px-3 py-2 md:table-cell">{cat?.name}</td>
							<td class="hidden px-3 py-2 md:table-cell">
								{item.locationId ? locationById.get(item.locationId)?.name : '—'}
							</td>
							{#each listDefs as def (def.key)}
								<td class="hidden px-3 py-2 lg:table-cell">
									{formatAttribute(def, item.attributes[def.key])}
								</td>
							{/each}
							<td class="px-3 py-2 text-right whitespace-nowrap" class:text-amber-700={low}>
								{formatQty(item.qtyOnHand, cat)}
							</td>
							<td
								class="hidden px-3 py-2 text-right whitespace-nowrap sm:table-cell"
								class:text-red-700={item.qtyAvailable < 0}
							>
								{formatQty(item.qtyAvailable, cat)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<div class="mt-3">
			<Pagination
				page={data.list.page}
				pageSize={data.list.pageSize}
				total={data.list.total}
				href={pageHref}
			/>
		</div>
	{/if}
{/if}

{#if selected.size > 0}
	<div
		class="fixed inset-x-0 bottom-14 z-20 mx-auto flex max-w-md items-center gap-2 rounded-lg border border-slate-200 bg-white p-2 pl-4 shadow-lg sm:bottom-4"
		role="region"
		aria-label="Selection"
	>
		<span class="text-sm font-medium">{selected.size} selected</span>
		<button class="btn btn-sm ml-auto" onclick={() => selected.clear()}>Clear</button>
		<button class="btn btn-sm btn-primary" onclick={() => (labelOpen = true)}>Print labels</button>
	</div>
{/if}

<LabelDialog bind:open={labelOpen} skus={[...selected]} />
