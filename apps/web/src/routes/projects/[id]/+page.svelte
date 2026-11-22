<script lang="ts">
	import type { ItemWithAvailability, PickLine, ProjectStatus } from '@inventory/shared';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '#lib/api.js';
	import ErrorAlert from '#lib/components/ErrorAlert.svelte';
	import ItemPicker from '#lib/components/ItemPicker.svelte';
	import LabelDialog from '#lib/components/LabelDialog.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import ReservationDialog, {
		type ReservationAction
	} from '#lib/components/ReservationDialog.svelte';
	import ReserveDialog from '#lib/components/ReserveDialog.svelte';
	import { formatQty, PROJECT_STATUS_LABELS } from '#lib/format.js';
	import { flattenTree } from '#lib/tree.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const project = $derived(data.project);
	const isOpen = $derived(project.status === 'planning' || project.status === 'active');
	const categoryById = $derived(new Map(data.categories.map((c) => [c.id, c])));
	const locationPaths = $derived(
		new Map(flattenTree(data.locations).map((e) => [e.node.id, e.path]))
	);
	const openLines = $derived(data.lines.filter((l) => l.status === 'reserved'));
	const closedLines = $derived(data.lines.filter((l) => l.status !== 'reserved'));
	const shortLines = $derived(openLines.filter((l) => l.shortBy > 0));

	let error = $state<unknown>(null);

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

	// Add a part
	let reserveItem = $state<ItemWithAvailability | null>(null);
	let reserveOpen = $state(false);

	function pickItem(item: ItemWithAvailability) {
		reserveItem = item;
		reserveOpen = true;
	}

	// Pick / change / release a line
	let line = $state<PickLine | null>(null);
	let lineAction = $state<ReservationAction>('pick');
	let lineOpen = $state(false);

	function openLine(l: PickLine, action: ReservationAction) {
		line = l;
		lineAction = action;
		lineOpen = true;
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

	// Bulk actions and delete
	let confirm = $state<'consume' | 'release' | 'delete' | null>(null);
	let confirmOpen = $state(false);
	let labelOpen = $state(false);

	function ask(kind: 'consume' | 'release' | 'delete') {
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

	const STATUS_TEXT: Record<string, string> = {
		consumed: 'Used',
		released: 'Released'
	};
</script>

{#snippet lineActions(l: PickLine)}
	<button class="btn btn-sm btn-primary" onclick={() => openLine(l, 'pick')}>Pick</button>
	<button class="btn btn-sm" onclick={() => openLine(l, 'edit')}>Change</button>
	<button
		class="btn btn-sm"
		onclick={() => run(() => api.reservations.update(l.id, { status: 'released' }))}
	>
		Release
	</button>
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
				<ItemPicker id="add-part" onselect={pickItem} />
			</div>
			<a class="btn" href={resolve(`/scan?mode=pick&project=${project.id}`)}>Pick with scanner</a>
		</div>
	</section>
{/if}

<section class="card mt-4 p-0" aria-labelledby="reserved-heading">
	<div class="flex flex-wrap items-center gap-2 px-4 pt-4">
		<h2 id="reserved-heading" class="font-semibold">Reserved parts</h2>
		{#if shortLines.length > 0}
			<span class="text-sm font-medium text-red-700">
				{shortLines.length} short of stock
			</span>
		{/if}
		{#if openLines.length > 0}
			<span class="ml-auto flex gap-2">
				<button class="btn btn-sm" onclick={() => ask('release')}>Release all</button>
				<button class="btn btn-sm btn-primary" onclick={() => ask('consume')}>Use all</button>
			</span>
		{/if}
	</div>
	{#if openLines.length === 0}
		<p class="px-4 py-4 text-sm text-slate-500">
			Nothing is reserved{isOpen ? '. Add parts above.' : '.'}
		</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="mt-3 w-full text-left text-sm">
				<thead class="border-y border-slate-200 bg-slate-50 text-xs text-slate-500 uppercase">
					<tr>
						<th class="px-4 py-2">Item</th>
						<th class="hidden px-3 py-2 md:table-cell">Location</th>
						<th class="px-3 py-2 text-right">Reserved</th>
						<th class="hidden px-3 py-2 text-right sm:table-cell">On hand</th>
						<th class="hidden px-3 py-2 sm:table-cell"><span class="sr-only">Actions</span></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each openLines as l (l.id)}
						{@const cat = categoryById.get(l.item.categoryId)}
						<tr data-testid="reserved-line" data-sku={l.sku}>
							<td class="px-4 py-2">
								<a class="link font-medium" href={resolve('/items/[sku]', { sku: l.sku })}>
									{l.item.name}
								</a>
								<div class="font-mono text-xs text-slate-500">{l.sku}</div>
								{#if l.shortBy > 0}
									<div class="text-xs font-medium text-red-700">
										Short by {formatQty(l.shortBy, cat)}
									</div>
								{:else if l.item.qtyAvailable < 0}
									<div class="text-xs text-amber-700">
										Other projects also need this; stock is over-committed
									</div>
								{/if}
								<!-- Phones: actions under the name, so the name keeps its width -->
								<div class="mt-2 flex gap-1 sm:hidden">{@render lineActions(l)}</div>
							</td>
							<td class="hidden px-3 py-2 md:table-cell">
								{l.item.locationId ? locationPaths.get(l.item.locationId) : '—'}
							</td>
							<td class="px-3 py-2 text-right whitespace-nowrap">
								{formatQty(l.qtyReserved, cat)}
							</td>
							<td class="hidden px-3 py-2 text-right whitespace-nowrap sm:table-cell">
								{formatQty(l.item.qtyOnHand, cat)}
							</td>
							<td class="hidden px-3 py-2 sm:table-cell">
								<span class="flex justify-end gap-1">{@render lineActions(l)}</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

{#if closedLines.length > 0}
	<section class="card mt-4" aria-labelledby="history-heading">
		<h2 id="history-heading" class="mb-2 font-semibold">Used and released</h2>
		<ul class="divide-y divide-slate-100 text-sm">
			{#each closedLines as l (l.id)}
				{@const cat = categoryById.get(l.item.categoryId)}
				<li class="flex flex-wrap items-baseline gap-x-2 py-1.5">
					<a class="link font-mono" href={resolve('/items/[sku]', { sku: l.sku })}>{l.sku}</a>
					<span class="text-slate-600">{l.item.name}</span>
					<span class="ml-auto whitespace-nowrap">
						{STATUS_TEXT[l.status]} · {formatQty(l.qtyReserved, cat)}
					</span>
				</li>
			{/each}
		</ul>
		<p class="mt-2 text-xs text-slate-500">
			Partial picks appear in each item's history as "Used for project".
		</p>
	</section>
{/if}

{#if reserveItem}
	<ReserveDialog
		bind:open={reserveOpen}
		item={reserveItem}
		category={categoryById.get(reserveItem.categoryId)!}
		projectId={project.id}
		ondone={() => invalidateAll()}
	/>
{/if}

{#if line}
	<ReservationDialog
		bind:open={lineOpen}
		action={lineAction}
		reservation={line}
		category={categoryById.get(line.item.categoryId)!}
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
			{#if (status === 'completed' || status === 'cancelled') && openLines.length > 0}
				<p class="mt-1 text-xs text-amber-700">
					Use or release the {openLines.length} reserved part{openLines.length === 1 ? '' : 's'}
					first.
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
			Deletes “{project.name}” and its reservations; reserved parts return to stock. Stock history
			is kept.
		{/if}
	</p>
	{#snippet actions()}
		<button class="btn" onclick={() => (confirmOpen = false)}>Cancel</button>
		<button class="btn {confirm === 'delete' ? 'btn-danger' : 'btn-primary'}" onclick={confirmed}>
			{confirm === 'consume' ? 'Use all' : confirm === 'release' ? 'Release all' : 'Delete'}
		</button>
	{/snippet}
</Modal>
