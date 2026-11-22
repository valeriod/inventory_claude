<script lang="ts">
	import type { Category } from '@inventory/shared';
	import { api } from '#lib/api.js';
	import { formatQty } from '#lib/format.js';
	import ErrorAlert from './ErrorAlert.svelte';
	import Modal from './Modal.svelte';
	import QuantityInput from './QuantityInput.svelte';

	export type ReservationAction = 'pick' | 'edit';

	/**
	 * Pick (consume) a reservation — all of it, or part with the rest staying reserved — or change
	 * its quantity.
	 */
	let {
		open = $bindable(false),
		action,
		reservation,
		category,
		ondone
	}: {
		open: boolean;
		action: ReservationAction;
		reservation: {
			id: number;
			qtyReserved: number;
			item: { name: string; qtyOnHand: number };
		};
		category: Pick<Category, 'unitKind' | 'displayUnit'>;
		ondone: (picked: number) => void;
	} = $props();

	let qty = $state<number | null>(null);
	let valid = $state(true);
	let note = $state('');
	let error = $state<unknown>(null);
	let busy = $state(false);

	// Start from the reserved quantity each time the dialog opens (before the form re-renders).
	$effect.pre(() => {
		if (open) {
			qty = reservation.qtyReserved;
			note = '';
			error = null;
		}
	});

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		if (qty === null || !valid || qty <= 0) {
			error = new Error('Enter a quantity');
			return;
		}
		busy = true;
		try {
			if (action === 'pick') {
				await api.reservations.update(reservation.id, {
					status: 'consumed',
					qty,
					note: note.trim() || null
				});
			} else {
				await api.reservations.update(reservation.id, { qty });
			}
			open = false;
			ondone(action === 'pick' ? qty : 0);
		} catch (err) {
			error = err;
		} finally {
			busy = false;
		}
	}
</script>

<Modal bind:open title={action === 'pick' ? 'Pick for project' : 'Change reserved quantity'}>
	{#key open}
		<form id="reservation-form" onsubmit={submit} class="space-y-4">
			<p class="text-sm text-slate-600">
				{reservation.item.name} · reserved {formatQty(reservation.qtyReserved, category)} · on hand
				{formatQty(reservation.item.qtyOnHand, category)}
			</p>
			<div>
				<label class="label" for="reservation-qty">
					{action === 'pick' ? 'Quantity taken' : 'Reserved quantity'}
				</label>
				<QuantityInput
					id="reservation-qty"
					kind={category.unitKind}
					unit={category.displayUnit}
					bind:valid
					bind:value={qty}
				/>
				{#if action === 'pick'}
					<p class="mt-1 text-xs text-slate-500">Taking less leaves the rest reserved for later.</p>
				{/if}
			</div>
			{#if action === 'pick'}
				<div>
					<label class="label" for="reservation-note">Note</label>
					<input id="reservation-note" class="input" bind:value={note} maxlength="1000" />
				</div>
			{/if}
			<ErrorAlert {error} />
		</form>
	{/key}
	{#snippet actions()}
		<button type="button" class="btn" onclick={() => (open = false)}>Cancel</button>
		<button type="submit" form="reservation-form" class="btn btn-primary" disabled={busy}>
			{action === 'pick' ? 'Take from stock' : 'Save'}
		</button>
	{/snippet}
</Modal>
