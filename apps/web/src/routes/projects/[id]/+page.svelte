<script lang="ts">
	import type { BomLine, ItemWithAvailability, ProjectStatus } from '@inventory/shared';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '#lib/api.js';
	import BomLineDialog from '#lib/components/BomLineDialog.svelte';
	import ErrorAlert from '#lib/components/ErrorAlert.svelte';
	import ItemPicker from '#lib/components/ItemPicker.svelte';
	import LabelDialog from '#lib/components/LabelDialog.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import ReservationDialog from '#lib/components/ReservationDialog.svelte';
	import { formatQty, PROJECT_STATUS_LABELS } from '#lib/format.js';
	import { flattenTree } from '#lib/tree.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const project = $derived(data.project);
	const isOpen = $derived(project.status === 'planning' || project.status === 'active');
	const categoryById = $derived(new Map(data.categories.map((c) => [c.id, c])));
	const locationCodes = $derived(new Map(data.locations.map((l) => [l.id, l.code])));
	const locationPaths = $derived(
		new Map(flattenTree(data.locations).map((e) => [e.node.id, e.path]))
	);
	const reservedLines = $derived(data.bom.filter((l) => l.qtyReserved > 0));
	const toBuyLines = $derived(data.bom.filter((l) => l.qtyToBuy > 0));
	const canReserveLines = $derived(data.bom.filter((l) => l.qtyCanReserve > 0));

	let error = $state<unknown>(null);

	async function run(action: () => Promise<unknown>) {
		error = null;
		try {
			await action();
			await invalidateAll();
		} catch (err) {
			error = err;
		}
	}

	// Edit project
	let editOpen = $state(false);
	let name = $state('');
	let description = $state('');
	let status = $state<ProjectStatus>('active');
	let editError = $state<unknown>(null);

	function startEdit() {
		name = project.name;
		description = project.description ?? '';
		status = project.status;
		editError = null;
		editOpen = true;
	}

	async function saveEdit(e: SubmitEvent) {
		e.preventDefault();
		editError = null;
		try {
			await api.projects.update(project.id, {
				name: name.trim(),
				description: description.trim() || null,
				status
			});
			editOpen = false;
			await invalidateAll();
		} catch (err) {
			editError = err;
		}
	}

	// Add or edit a parts-list line
	let lineItem = $state<{
		sku: string;
		name: string;
		categoryId: number;
		qtyOnHand: number;
		qtyAvailable: number;
	} | null>(null);
	let lineEditing = $state<BomLine | null>(null);
	let lineOpen = $state(false);

	function addItem(item: ItemWithAvailability) {
		const existing = data.bom.find((l) => l.sku === item.sku);
		if (existing) return editLine(existing);
		lineItem = item;
		lineEditing = null;
		lineOpen = true;
	}

	function editLine(l: BomLine) {
		lineItem = { sku: l.sku, ...l.item };
		lineEditing = l;
		lineOpen = true;
	}

	// Pick a reserved line
	let pickLine = $state<BomLine | null>(null);
	let pickOpen = $state(false);

	function pick(l: BomLine) {
		pickLine = l;
		pickOpen = true;
	}

	// Bulk actions and delete
	type Confirm = 'consume' | 'release' | 'delete';
	let confirm = $state<Confirm | null>(null);
	let confirmOpen = $state(false);
	let labelOpen = $state(false);

	function ask(kind: Confirm) {
		confirm = kind;
		confirmOpen = true;
	}

	async function confirmed() {
		const kind = confirm;
		confirmOpen = false;
		if (kind === 'consume') await run(() => api.projects.consumeAll(project.id));
		else if (kind === 'release') await run(() => api.projects.releaseAll(project.id));
		else if (kind === 'delete') {
			error = null;
			try {
				await api.projects.remove(project.id);
				await goto(resolve('/projects'));
			} catch (err) {
				error = err;
			}
		}
	}
</script>

{#snippet lineActions(l: BomLine)}
	{#if l.qtyReserved > 0}
		<button class="btn btn-sm btn-primary" onclick={() => pick(l)}>Pick</button>
	{/if}
	{#if isOpen && l.qtyCanReserve > 0}
		<button
			class="btn btn-sm"
			onclick={() =>
				run(() => api.projects.reserve(project.id, { sku: l.sku, qty: l.qtyCanReserve }))}
		>
			Reserve {formatQty(l.qtyCanReserve, categoryById.get(l.item.categoryId))}
		</button>
	{/if}
	{#if isOpen}
		<button class="btn btn-sm" onclick={() => editLine(l)}>Edit</button>
	{/if}
{/snippet}

{#snippet status_(l: BomLine)}
	{@const cat = categoryById.get(l.item.categoryId)}
	{#if l.qtyToBuy > 0}
		<span class="font-medium text-red-700">To buy {formatQty(l.qtyToBuy, cat)}</span>
	{:else if l.qtyCanReserve > 0}
		<span class="text-amber-700">Can reserve {formatQty(l.qtyCanReserve, cat)}</span>
	{:else if l.qtyReserved > 0}
		<span class="text-green-700">Reserved</span>
	{:else if l.qtyNeeded !== null && l.qtyUsed >= l.qtyNeeded}
		<span class="text-slate-500">Used</span>
	{:else}
		<span class="text-slate-500">—</span>
	{/if}
	{#if l.qtyReserved > 0 && l.item.qtyAvailable < 0}
		<div class="text-xs text-amber-700">Stock is over-committed</div>
	{/if}
{/snippet}

<svelte:head><title>{project.name} · Inventory</title></svelte:head>

<div class="mb-4 flex flex-wrap items-start justify-between gap-3">
	<div class="min-w-0">
		<p class="text-sm text-slate-500">
			<a class="link" href={resolve('/projects')}>Projects</a> · #{project.id}
		</p>
		<h1 class="text-2xl font-bold break-words">
			{project.name}
			<span class="badge ml-1 align-middle text-sm">{PROJECT_STATUS_LABELS[project.status]}</span>
		</h1>
		{#if project.description}
			<p class="mt-1 whitespace-pre-line text-slate-600">{project.description}</p>
		{/if}
	</div>
	<div class="flex flex-wrap gap-2">
		<button class="btn" onclick={startEdit}>Edit</button>
		<a class="btn" href={resolve(`/reports?report=project&project=${project.id}`)}>Report</a>
		<button class="btn" onclick={() => (labelOpen = true)}>Print label</button>
		<button class="btn btn-danger" onclick={() => ask('delete')}>Delete…</button>
	</div>
</div>

<ErrorAlert {error} />

{#if isOpen}
	<section class="card mt-4" aria-label="Add parts">
		<div class="flex flex-wrap items-end gap-2">
			<div class="min-w-64 flex-1">
				<label class="label" for="add-part">Add a part</label>
				<ItemPicker id="add-part" onselect={addItem} />
			</div>
			<a class="btn" href={resolve(`/scan?mode=pick&project=${project.id}`)}>Pick with scanner</a>
		</div>
	</section>
{/if}

<section class="card mt-4 p-0" aria-labelledby="parts-heading">
	<div class="flex flex-wrap items-center gap-2 px-4 pt-4">
		<h2 id="parts-heading" class="font-semibold">Parts</h2>
		{#if toBuyLines.length > 0}
			<span class="text-sm font-medium text-red-700" data-testid="to-buy-count">
				{toBuyLines.length} to buy
			</span>
		{/if}
		<span class="ml-auto flex flex-wrap gap-2">
			{#if isOpen && canReserveLines.length > 0}
				<button
					class="btn btn-sm"
					onclick={() => run(() => api.projects.reserveNeeded(project.id))}
				>
					Reserve available
				</button>
			{/if}
			{#if reservedLines.length > 0}
				<button class="btn btn-sm" onclick={() => ask('release')}>Release all</button>
				<button class="btn btn-sm btn-primary" onclick={() => ask('consume')}>Use all</button>
			{/if}
		</span>
	</div>
	{#if data.bom.length === 0}
		<p class="px-4 py-4 text-sm text-slate-500">
			No parts yet{isOpen ? '. Add what the project needs above.' : '.'}
		</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="mt-3 w-full text-left text-sm">
				<thead class="border-y border-slate-200 bg-slate-50 text-xs text-slate-500 uppercase">
					<tr>
						<th class="px-4 py-2">Item</th>
						<th class="hidden px-3 py-2 lg:table-cell">Location</th>
						<th class="px-3 py-2 text-right">Needed</th>
						<th class="hidden px-3 py-2 text-right md:table-cell">Used</th>
						<th class="px-3 py-2 text-right">Reserved</th>
						<th class="hidden px-3 py-2 md:table-cell">Status</th>
						<th class="hidden px-3 py-2 sm:table-cell"><span class="sr-only">Actions</span></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each data.bom as l (l.sku)}
						{@const cat = categoryById.get(l.item.categoryId)}
						<tr data-testid="bom-line" data-sku={l.sku}>
							<td class="px-4 py-2">
								<a class="link font-medium" href={resolve('/items/[sku]', { sku: l.sku })}>
									{l.item.name}
								</a>
								<div class="font-mono text-xs text-slate-500">
									{l.sku}{#if l.item.locationId}
										<span class="lg:hidden">&nbsp;· {locationCodes.get(l.item.locationId)}</span>
									{/if}
								</div>
								<div class="text-xs md:hidden">{@render status_(l)}</div>
								<!-- Phones: actions under the name, so the name keeps its width -->
								<div class="mt-2 flex flex-wrap gap-1 sm:hidden">{@render lineActions(l)}</div>
							</td>
							<td class="hidden px-3 py-2 lg:table-cell">
								{l.item.locationId ? locationPaths.get(l.item.locationId) : '—'}
							</td>
							<td class="px-3 py-2 text-right whitespace-nowrap">
								{l.qtyNeeded === null ? '—' : formatQty(l.qtyNeeded, cat)}
							</td>
							<td class="hidden px-3 py-2 text-right whitespace-nowrap md:table-cell">
								{l.qtyUsed ? formatQty(l.qtyUsed, cat) : '—'}
							</td>
							<td class="px-3 py-2 text-right whitespace-nowrap">
								{l.qtyReserved ? formatQty(l.qtyReserved, cat) : '—'}
							</td>
							<td class="hidden px-3 py-2 md:table-cell">{@render status_(l)}</td>
							<td class="hidden px-3 py-2 sm:table-cell">
								<span class="flex justify-end gap-1">{@render lineActions(l)}</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
	<p class="px-4 py-3 text-xs text-slate-500">
		<a class="link" href={resolve(`/reports?report=movements&project=${project.id}`)}>
			Stock history of this project
		</a>
	</p>
</section>

{#if lineItem}
	<BomLineDialog
		bind:open={lineOpen}
		projectId={project.id}
		item={lineItem}
		category={categoryById.get(lineItem.categoryId)!}
		line={lineEditing}
		ondone={() => invalidateAll()}
	/>
{/if}

{#if pickLine && pickLine.reservationId !== null}
	<ReservationDialog
		bind:open={pickOpen}
		action="pick"
		reservation={{
			id: pickLine.reservationId,
			qtyReserved: pickLine.qtyReserved,
			item: pickLine.item
		}}
		category={categoryById.get(pickLine.item.categoryId)!}
		ondone={() => invalidateAll()}
	/>
{/if}

<LabelDialog bind:open={labelOpen} projects={[project.id]} />

<Modal bind:open={editOpen} title="Edit project">
	<form id="project-edit-form" onsubmit={saveEdit} class="space-y-3">
		<div>
			<label class="label" for="edit-name">Name</label>
			<input id="edit-name" class="input" bind:value={name} required maxlength="200" />
		</div>
		<div>
			<label class="label" for="edit-description">Description</label>
			<textarea id="edit-description" class="input" rows="3" bind:value={description}></textarea>
		</div>
		<div>
			<label class="label" for="edit-status">Status</label>
			<select id="edit-status" class="input" bind:value={status}>
				{#each Object.entries(PROJECT_STATUS_LABELS) as [value, label] (value)}
					<option {value}>{label}</option>
				{/each}
			</select>
			{#if (status === 'completed' || status === 'cancelled') && reservedLines.length > 0}
				<p class="mt-1 text-xs text-amber-700">
					Use or release the {reservedLines.length} reserved part{reservedLines.length === 1
						? ''
						: 's'} first.
				</p>
			{/if}
		</div>
		<ErrorAlert error={editError} />
	</form>
	{#snippet actions()}
		<button class="btn" onclick={() => (editOpen = false)}>Cancel</button>
		<button class="btn btn-primary" type="submit" form="project-edit-form">Save</button>
	{/snippet}
</Modal>

<Modal
	bind:open={confirmOpen}
	title={confirm === 'consume'
		? 'Use all reserved parts?'
		: confirm === 'release'
			? 'Release all reserved parts?'
			: 'Delete project?'}
>
	<p class="text-sm">
		{#if confirm === 'consume'}
			Takes every reserved part out of stock. If any line is short, nothing is changed.
		{:else if confirm === 'release'}
			Returns every reserved part to available stock.
		{:else}
			Deletes “{project.name}”, its parts list and its reservations; reserved parts return to stock.
			Stock history is kept.
		{/if}
	</p>
	{#snippet actions()}
		<button class="btn" onclick={() => (confirmOpen = false)}>Cancel</button>
		<button class="btn {confirm === 'delete' ? 'btn-danger' : 'btn-primary'}" onclick={confirmed}>
			{confirm === 'consume' ? 'Use all' : confirm === 'release' ? 'Release all' : 'Delete'}
		</button>
	{/snippet}
</Modal>
