<script lang="ts">
	import type { Location } from '@inventory/shared';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '#lib/api.js';
	import ErrorAlert from '#lib/components/ErrorAlert.svelte';
	import LabelDialog from '#lib/components/LabelDialog.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import TreeSelect from '#lib/components/TreeSelect.svelte';
	import { descendantIds, flattenTree } from '#lib/tree.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const entries = $derived(flattenTree(data.locations));

	let editing = $state<Location | null>(null);
	let open = $state(false);
	let name = $state('');
	let code = $state('');
	let parentId = $state<number | null>(null);
	let description = $state('');
	let error = $state<unknown>(null);
	let listError = $state<unknown>(null);
	let labelCodes = $state<string[]>([]);
	let labelOpen = $state(false);

	/** Labels for a location and everything inside it, in tree order; or for all locations. */
	function printLabels(root?: Location) {
		const ids = root ? descendantIds(data.locations, root.id) : null;
		labelCodes = entries.filter((e) => !ids || ids.has(e.node.id)).map((e) => e.node.code);
		labelOpen = true;
	}

	function startCreate(parent: number | null = null) {
		editing = null;
		name = '';
		code = '';
		parentId = parent;
		description = '';
		error = null;
		open = true;
	}

	function startEdit(location: Location) {
		editing = location;
		name = location.name;
		code = location.code;
		parentId = location.parentId;
		description = location.description ?? '';
		error = null;
		open = true;
	}

	async function save(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		const body = {
			name: name.trim(),
			code: code.trim(),
			parentId,
			description: description.trim() || null
		};
		try {
			if (editing) await api.locations.update(editing.id, body);
			else await api.locations.create(body);
			open = false;
			await invalidateAll();
		} catch (err) {
			error = err;
		}
	}

	async function remove(location: Location) {
		listError = null;
		try {
			await api.locations.remove(location.id);
			await invalidateAll();
		} catch (err) {
			listError = err;
		}
	}
</script>

<div class="mb-4 flex items-center justify-between gap-2">
	<h1 class="text-2xl font-bold">Locations</h1>
	<div class="flex gap-2">
		{#if entries.length > 0}
			<button class="btn" onclick={() => printLabels()}>Print all labels</button>
		{/if}
		<button class="btn btn-primary" onclick={() => startCreate()}>+ New location</button>
	</div>
</div>

<ErrorAlert error={listError} />

{#if entries.length === 0}
	<p class="card text-center text-slate-500">No locations yet.</p>
{:else}
	<ul class="card mt-2 divide-y divide-slate-100 p-0">
		{#each entries as { node, depth } (node.id)}
			<li
				class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
				style:padding-left="{1 + depth * 1.5}rem"
			>
				<span class="font-medium">{node.name}</span>
				<code class="text-xs text-slate-500">{node.code}</code>
				<span class="ml-auto flex flex-wrap gap-1">
					<a class="btn btn-sm" href={resolve(`/items?location=${node.id}`)}>Items</a>
					<button class="btn btn-sm" onclick={() => startCreate(node.id)}>+ Inside</button>
					<button
						class="btn btn-sm"
						onclick={() => printLabels(node)}
						title="Print labels for this location and everything inside it"
					>
						Labels
					</button>
					<button class="btn btn-sm" onclick={() => startEdit(node)}>Edit</button>
					<button class="btn btn-sm" onclick={() => remove(node)}>Delete</button>
				</span>
			</li>
		{/each}
	</ul>
{/if}

<Modal bind:open title={editing ? 'Edit location' : 'New location'}>
	<form id="location-form" onsubmit={save} class="space-y-3">
		<div>
			<label class="label" for="loc-name">Name</label>
			<input id="loc-name" class="input" bind:value={name} required />
		</div>
		<div>
			<label class="label" for="loc-code">Code (printed on the label)</label>
			<input id="loc-code" class="input font-mono" bind:value={code} required />
		</div>
		<div>
			<label class="label" for="loc-parent">Inside</label>
			<TreeSelect
				id="loc-parent"
				nodes={data.locations}
				bind:value={parentId}
				placeholder="— top level —"
				exclude={editing ? descendantIds(data.locations, editing.id) : undefined}
			/>
		</div>
		<div>
			<label class="label" for="loc-desc">Description</label>
			<input id="loc-desc" class="input" bind:value={description} />
		</div>
		<ErrorAlert {error} />
	</form>
	{#snippet actions()}
		<button class="btn" onclick={() => (open = false)}>Cancel</button>
		<button class="btn btn-primary" type="submit" form="location-form">Save</button>
	{/snippet}
</Modal>

<LabelDialog bind:open={labelOpen} locations={labelCodes} />
