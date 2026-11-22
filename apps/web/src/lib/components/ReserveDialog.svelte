<script lang="ts">
	import type { Category, Project } from '@inventory/shared';
	import { api } from '#lib/api.js';
	import { formatQty } from '#lib/format.js';
	import ErrorAlert from './ErrorAlert.svelte';
	import Modal from './Modal.svelte';
	import QuantityInput from './QuantityInput.svelte';

	/**
	 * Reserve an item for a project. Give `projectId` to reserve for a fixed project (project
	 * page), or `projects` to let the user choose one (item page).
	 */
	let {
		open = $bindable(false),
		item,
		category,
		projectId,
		projects = [],
		ondone
	}: {
		open: boolean;
		item: { sku: string; name: string; qtyAvailable: number };
		category: Pick<Category, 'unitKind' | 'displayUnit'>;
		projectId?: number;
		projects?: Pick<Project, 'id' | 'name'>[];
		ondone: () => void;
	} = $props();

	let chosen = $state<number | null>(null);
	let qty = $state<number | null>(null);
	let valid = $state(true);
	let note = $state('');
	let error = $state<unknown>(null);
	let busy = $state(false);

	$effect(() => {
		if (open) {
			chosen = projectId ?? projects[0]?.id ?? null;
			error = null;
		}
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		if (chosen === null) {
			error = new Error('Choose a project');
			return;
		}
		if (qty === null || !valid || qty <= 0) {
			error = new Error('Enter a quantity');
			return;
		}
		busy = true;
		try {
			await api.projects.reserve(chosen, { sku: item.sku, qty, note: note.trim() || null });
			open = false;
			ondone();
		} catch (err) {
			error = err;
		} finally {
			busy = false;
		}
	}
</script>

<Modal bind:open title="Reserve for a project">
	{#key open}
		<form id="reserve-form" onsubmit={submit} class="space-y-4">
			<p class="text-sm text-slate-600">
				{item.name} · available {formatQty(item.qtyAvailable, category)}
			</p>
			{#if projectId === undefined}
				{#if projects.length === 0}
					<p class="text-sm text-slate-600">
						There is no planning or active project. Create one under Projects first.
					</p>
				{:else}
					<div>
						<label class="label" for="reserve-project">Project</label>
						<select id="reserve-project" class="input" bind:value={chosen}>
							{#each projects as p (p.id)}
								<option value={p.id}>{p.name}</option>
							{/each}
						</select>
					</div>
				{/if}
			{/if}
			<div>
				<label class="label" for="reserve-qty">Quantity to reserve</label>
				<QuantityInput
					id="reserve-qty"
					kind={category.unitKind}
					unit={category.displayUnit}
					bind:value={qty}
					bind:valid
				/>
			</div>
			<div>
				<label class="label" for="reserve-note">Note</label>
				<input id="reserve-note" class="input" bind:value={note} maxlength="1000" />
			</div>
			<ErrorAlert {error} />
		</form>
	{/key}
	{#snippet actions()}
		<button type="button" class="btn" onclick={() => (open = false)}>Cancel</button>
		<button
			type="submit"
			form="reserve-form"
			class="btn btn-primary"
			disabled={busy || (projectId === undefined && projects.length === 0)}
		>
			Reserve
		</button>
	{/snippet}
</Modal>
