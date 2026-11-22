<script lang="ts">
	import type { Category, ItemWithAvailability } from '@inventory/shared';
	import { api, type StockChangeResponse } from '#lib/api.js';
	import { formatQty } from '#lib/format.js';
	import ErrorAlert from './ErrorAlert.svelte';
	import Modal from './Modal.svelte';
	import QuantityInput from './QuantityInput.svelte';

	export type StockMode = 'receive' | 'consume' | 'adjust' | 'count';

	let {
		open = $bindable(false),
		mode,
		item,
		category,
		ondone
	}: {
		open: boolean;
		mode: StockMode;
		item: ItemWithAvailability;
		category: Category;
		ondone: (result: StockChangeResponse) => void;
	} = $props();

	const TITLES: Record<StockMode, string> = {
		receive: 'Receive stock',
		consume: 'Use stock',
		adjust: 'Adjust stock',
		count: 'Record a count'
	};
	const LABELS: Record<StockMode, string> = {
		receive: 'Quantity received',
		consume: 'Quantity used',
		adjust: 'Change (negative to subtract)',
		count: 'Counted quantity'
	};

	let qty = $state<number | null>(null);
	let valid = $state(true);
	let note = $state('');
	let error = $state<unknown>(null);
	let busy = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		if (qty === null || !valid || (mode !== 'count' && qty === 0)) {
			error = new Error('Enter a quantity');
			return;
		}
		busy = true;
		try {
			const n = note.trim() || null;
			const result =
				mode === 'count'
					? await api.items.count(item.sku, { countedQty: qty, note: n })
					: await api.items.addMovement(item.sku, {
							reason: mode,
							delta: mode === 'consume' ? -Math.abs(qty) : mode === 'receive' ? Math.abs(qty) : qty,
							note: n
						});
			open = false;
			ondone(result);
		} catch (err) {
			error = err;
		} finally {
			busy = false;
		}
	}
</script>

<Modal bind:open title={TITLES[mode]}>
	{#key open}
		<form id="stock-form" onsubmit={submit} class="space-y-4">
			<p class="text-sm text-slate-600">
				{item.name} · on hand {formatQty(item.qtyOnHand, category)}
			</p>
			<div>
				<label class="label" for="stock-qty">{LABELS[mode]}</label>
				<QuantityInput
					id="stock-qty"
					kind={category.unitKind}
					unit={category.displayUnit}
					allowNegative={mode === 'adjust'}
					bind:value={qty}
					bind:valid
				/>
			</div>
			<div>
				<label class="label" for="stock-note">Note</label>
				<input id="stock-note" class="input" bind:value={note} maxlength="1000" />
			</div>
			<ErrorAlert {error} />
		</form>
	{/key}
	{#snippet actions()}
		<button type="button" class="btn" onclick={() => (open = false)}>Cancel</button>
		<button type="submit" form="stock-form" class="btn btn-primary" disabled={busy}>Save</button>
	{/snippet}
</Modal>
