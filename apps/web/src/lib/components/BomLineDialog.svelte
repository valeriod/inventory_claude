<script lang="ts">
	import type { BomLine, Category } from '@inventory/shared';
	import { api } from '#lib/api.js';
	import { formatQty } from '#lib/format.js';
	import ErrorAlert from './ErrorAlert.svelte';
	import Modal from './Modal.svelte';
	import QuantityInput from './QuantityInput.svelte';

	/**
	 * Add an item to a project's parts list (optionally reserving what is in stock), or edit a
	 * line: its needed quantity (empty removes it from the list) and its reservation (empty or 0
	 * releases it).
	 */
	let {
		open = $bindable(false),
		projectId,
		item,
		category,
		line = null,
		ondone
	}: {
		open: boolean;
		projectId: number;
		item: { sku: string; name: string; qtyOnHand: number; qtyAvailable: number };
		category: Pick<Category, 'unitKind' | 'displayUnit'>;
		/** The existing line when editing; null to add the item. */
		line?: BomLine | null;
		ondone: () => void;
	} = $props();

	let needed = $state<number | null>(null);
	let neededValid = $state(true);
	let reserved = $state<number | null>(null);
	let reservedValid = $state(true);
	let reserveNow = $state(true);
	let error = $state<unknown>(null);
	let busy = $state(false);

	// Initial values each time the dialog opens (before the form re-renders).
	$effect.pre(() => {
		if (open) {
			needed = line?.qtyNeeded ?? null;
			reserved = line?.qtyReserved || null;
			reserveNow = true;
			error = null;
		}
	});

	const editing = $derived(line !== null);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		if (!neededValid || !reservedValid) {
			error = new Error('Check the quantities');
			return;
		}
		if (!editing && (needed === null || needed <= 0)) {
			error = new Error('Enter the quantity the project needs');
			return;
		}
		busy = true;
		try {
			if (!editing) {
				await api.projects.setPart(projectId, item.sku, { qtyNeeded: needed! });
				const amount = Math.min(needed!, Math.max(0, item.qtyAvailable));
				if (reserveNow && amount > 0) {
					await api.projects.reserve(projectId, { sku: item.sku, qty: amount });
				}
			} else {
				const l = line!;
				if (needed !== l.qtyNeeded) {
					if (needed && needed > 0) {
						await api.projects.setPart(projectId, item.sku, { qtyNeeded: needed });
					} else if (l.qtyNeeded !== null) {
						await api.projects.removePart(projectId, item.sku);
					}
				}
				const target = reserved ?? 0;
				if (target !== l.qtyReserved) {
					if (l.reservationId !== null && target <= 0) {
						await api.reservations.update(l.reservationId, { status: 'released' });
					} else if (l.reservationId !== null) {
						await api.reservations.update(l.reservationId, { qty: target });
					} else if (target > 0) {
						await api.projects.reserve(projectId, { sku: item.sku, qty: target });
					}
				}
			}
			open = false;
			ondone();
		} catch (err) {
			error = err;
		} finally {
			busy = false;
		}
	}
</script>

<Modal bind:open title={editing ? 'Edit part' : 'Add to project'}>
	{#key open}
		<form id="bom-line-form" onsubmit={submit} class="space-y-4">
			<p class="text-sm text-slate-600">
				{item.name} · on hand {formatQty(item.qtyOnHand, category)} · available
				{formatQty(item.qtyAvailable, category)}
			</p>
			<div>
				<label class="label" for="bom-needed">Needed for the project</label>
				<QuantityInput
					id="bom-needed"
					kind={category.unitKind}
					unit={category.displayUnit}
					bind:value={needed}
					bind:valid={neededValid}
				/>
				{#if editing}
					<p class="mt-1 text-xs text-slate-500">Leave empty to take it off the parts list.</p>
				{/if}
			</div>
			{#if editing}
				<div>
					<label class="label" for="bom-reserved">Reserved from stock</label>
					<QuantityInput
						id="bom-reserved"
						kind={category.unitKind}
						unit={category.displayUnit}
						bind:value={reserved}
						bind:valid={reservedValid}
					/>
					<p class="mt-1 text-xs text-slate-500">Leave empty to release the reservation.</p>
				</div>
			{:else}
				<label class="flex items-center gap-2 text-sm">
					<input type="checkbox" bind:checked={reserveNow} />
					Reserve what is in stock now
				</label>
			{/if}
			<ErrorAlert {error} />
		</form>
	{/key}
	{#snippet actions()}
		<button type="button" class="btn" onclick={() => (open = false)}>Cancel</button>
		<button type="submit" form="bom-line-form" class="btn btn-primary" disabled={busy}>
			{editing ? 'Save' : 'Add'}
		</button>
	{/snippet}
</Modal>
