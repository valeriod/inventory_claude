<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '#lib/api.js';
	import ErrorAlert from '#lib/components/ErrorAlert.svelte';
	import LabelDialog from '#lib/components/LabelDialog.svelte';
	import ReserveDialog from '#lib/components/ReserveDialog.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import StockDialog, { type StockMode } from '#lib/components/StockDialog.svelte';
	import { formatAttribute, formatDateTime, formatQty, REASON_LABELS } from '#lib/format.js';
	import { flattenTree } from '#lib/tree.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let stockOpen = $state(false);
	let stockMode = $state<StockMode>('receive');
	let confirmDelete = $state(false);
	let labelOpen = $state(false);
	let reserveOpen = $state(false);
	const openReservations = $derived(data.reservations.filter((r) => r.status === 'reserved'));
	let error = $state<unknown>(null);

	const item = $derived(data.item);
	const category = $derived(data.category);
	const categoryPath = $derived(
		flattenTree(data.categories).find((e) => e.node.id === category.id)?.path
	);
	const locationPath = $derived(
		item.locationId
			? flattenTree(data.locations).find((e) => e.node.id === item.locationId)?.path
			: undefined
	);
	const declared = $derived(new Set(category.resolvedFieldDefs.map((d) => d.key)));
	const otherValues = $derived(Object.entries(item.attributes).filter(([k]) => !declared.has(k)));
	const low = $derived(item.qtyMin !== null && item.qtyAvailable <= item.qtyMin);

	function openStock(mode: StockMode) {
		stockMode = mode;
		stockOpen = true;
	}

	async function run(action: () => Promise<unknown>) {
		error = null;
		try {
			await action();
			await invalidateAll();
		} catch (err) {
			error = err;
		}
	}

	async function deletePermanently() {
		confirmDelete = false;
		error = null;
		try {
			await api.items.deletePermanently(item.sku);
			await goto(resolve('/items'));
		} catch (err) {
			error = err;
		}
	}
</script>

<svelte:head><title>{item.name} · Inventory</title></svelte:head>

<div class="mb-4 flex flex-wrap items-start justify-between gap-3">
	<div class="min-w-0">
		<p class="text-sm text-slate-500">{categoryPath}</p>
		<h1 class="text-2xl font-bold break-words">{item.name}</h1>
		<p class="font-mono text-sm text-slate-600">
			{item.sku}{#if item.barcode}
				· {item.barcode}{/if}
			{#if item.archivedAt}<span class="badge ml-2">Archived</span>{/if}
		</p>
	</div>
	<div class="flex flex-wrap gap-2">
		<a class="btn" href={resolve('/items/[sku]/edit', { sku: item.sku })}>Edit</a>
		<button class="btn" onclick={() => (labelOpen = true)}>Print label</button>
		{#if item.archivedAt}
			<button class="btn" onclick={() => run(() => api.items.restore(item.sku))}>Restore</button>
			<button class="btn btn-danger" onclick={() => (confirmDelete = true)}>Delete…</button>
		{:else}
			<button class="btn" onclick={() => run(() => api.items.archive(item.sku))}>Archive</button>
		{/if}
	</div>
</div>

<ErrorAlert {error} />

<div class="mt-4 grid gap-4 lg:grid-cols-3">
	<section class="card lg:col-span-1" aria-labelledby="stock-heading">
		<h2 id="stock-heading" class="mb-3 font-semibold">Stock</h2>
		<dl class="grid grid-cols-3 gap-2 text-center">
			<div>
				<dt class="text-xs text-slate-500">On hand</dt>
				<dd class="text-lg font-semibold" data-testid="qty-on-hand">
					{formatQty(item.qtyOnHand, category)}
				</dd>
			</div>
			<div>
				<dt class="text-xs text-slate-500">Reserved</dt>
				<dd class="text-lg font-semibold">{formatQty(item.qtyReserved, category)}</dd>
			</div>
			<div>
				<dt class="text-xs text-slate-500">Available</dt>
				<dd
					class="text-lg font-semibold"
					class:text-amber-600={low}
					class:text-red-700={item.qtyAvailable < 0}
				>
					{formatQty(item.qtyAvailable, category)}
				</dd>
			</div>
		</dl>
		{#if item.qtyMin !== null}
			<p class="mt-2 text-center text-xs text-slate-500">
				Reorder below {formatQty(item.qtyMin, category)}
			</p>
		{/if}
		<div class="mt-4 grid grid-cols-2 gap-2">
			<button class="btn btn-primary" onclick={() => openStock('receive')}>Receive</button>
			<button class="btn" onclick={() => openStock('consume')}>Use</button>
			<button class="btn" onclick={() => openStock('adjust')}>Adjust</button>
			<button class="btn" onclick={() => openStock('count')}>Count</button>
		</div>
		<p class="mt-4 text-sm"><span class="text-slate-500">Location:</span> {locationPath ?? '—'}</p>
		{#if item.description}<p class="mt-2 text-sm whitespace-pre-line">{item.description}</p>{/if}
	</section>

	<section class="card lg:col-span-2" aria-labelledby="details-heading">
		<h2 id="details-heading" class="mb-3 font-semibold">Details</h2>
		{#if category.resolvedFieldDefs.length === 0}
			<p class="text-sm text-slate-500">No custom fields.</p>
		{:else}
			<dl class="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
				{#each category.resolvedFieldDefs as def (def.key)}
					<div class="flex justify-between gap-3 border-b border-slate-100 py-1">
						<dt class="text-slate-500">{def.label}</dt>
						<dd class="text-right font-medium break-all">
							{#if def.type === 'url' && typeof item.attributes[def.key] === 'string'}
								<!-- eslint-disable svelte/no-navigation-without-resolve -- external datasheet URL -->
								<a
									class="link"
									href={String(item.attributes[def.key])}
									target="_blank"
									rel="noopener noreferrer"
								>
									Open
								</a>
								<!-- eslint-enable svelte/no-navigation-without-resolve -->
							{:else}
								{formatAttribute(def, item.attributes[def.key])}
							{/if}
						</dd>
					</div>
				{/each}
			</dl>
		{/if}
		{#if otherValues.length}
			<h3 class="mt-4 mb-1 text-sm font-medium text-slate-500">
				Other stored values (removed fields)
			</h3>
			<dl class="text-sm">
				{#each otherValues as [key, value] (key)}
					<div class="flex gap-2">
						<dt class="font-mono text-slate-500">{key}</dt>
						<dd>{formatAttribute(undefined, value)}</dd>
					</div>
				{/each}
			</dl>
		{/if}
	</section>

	<section class="card lg:col-span-2" aria-labelledby="history-heading">
		<h2 id="history-heading" class="mb-3 font-semibold">History</h2>
		{#if data.movements.length === 0}
			<p class="text-sm text-slate-500">No stock movements yet.</p>
		{:else}
			<ul class="divide-y divide-slate-100 text-sm">
				{#each data.movements as m (m.id)}
					<li class="flex items-center justify-between gap-3 py-2">
						<div class="min-w-0">
							<span class="font-medium">{REASON_LABELS[m.reason] ?? m.reason}</span>
							{#if m.note}<span class="text-slate-500"> · {m.note}</span>{/if}
							<div class="text-xs text-slate-500">{formatDateTime(m.createdAt)}</div>
						</div>
						<span
							class="shrink-0 font-mono"
							class:text-green-700={m.delta > 0}
							class:text-red-700={m.delta < 0}
						>
							{m.delta > 0 ? '+' : ''}{formatQty(m.delta, category)}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="card" aria-labelledby="reservations-heading">
		<div class="mb-3 flex items-center justify-between gap-2">
			<h2 id="reservations-heading" class="font-semibold">Reservations</h2>
			{#if !item.archivedAt}
				<button class="btn btn-sm" onclick={() => (reserveOpen = true)}>Reserve…</button>
			{/if}
		</div>
		{#if openReservations.length === 0}
			<p class="text-sm text-slate-500">Not reserved for any project.</p>
		{:else}
			<ul class="space-y-1 text-sm">
				{#each openReservations as r (r.id)}
					<li class="flex justify-between gap-2">
						<a class="link" href={resolve('/projects/[id]', { id: String(r.project.id) })}>
							{r.project.name}
						</a>
						<span>{formatQty(r.qtyReserved, category)}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<ReserveDialog
	bind:open={reserveOpen}
	{item}
	{category}
	projects={data.openProjects}
	ondone={() => invalidateAll()}
/>

<StockDialog
	bind:open={stockOpen}
	mode={stockMode}
	{item}
	{category}
	ondone={() => invalidateAll()}
/>

<LabelDialog bind:open={labelOpen} skus={[item.sku]} />

<Modal bind:open={confirmDelete} title="Delete permanently?">
	<p class="text-sm">
		This removes {item.sku} for good. Items with stock history cannot be deleted; they stay archived.
	</p>
	{#snippet actions()}
		<button class="btn" onclick={() => (confirmDelete = false)}>Cancel</button>
		<button class="btn btn-danger" onclick={deletePermanently}>Delete</button>
	{/snippet}
</Modal>
