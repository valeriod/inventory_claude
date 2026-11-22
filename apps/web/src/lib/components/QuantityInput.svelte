<script lang="ts">
	import { fromBase, toBase, unitsFor, type UnitKind } from '@inventory/shared';

	/**
	 * Number + unit input that produces integer base units (plan §3.4).
	 * `value` is null when empty; `valid` is false while the text cannot be read.
	 */
	let {
		kind,
		unit: initialUnit,
		value = $bindable(null),
		valid = $bindable(true),
		allowNegative = false,
		id,
		placeholder = ''
	}: {
		kind: UnitKind;
		unit: string;
		value: number | null;
		valid?: boolean;
		allowNegative?: boolean;
		id?: string;
		placeholder?: string;
	} = $props();

	// Initial values only; the component owns the text and unit afterwards.
	// svelte-ignore state_referenced_locally
	let unit = $state(initialUnit);
	// svelte-ignore state_referenced_locally
	let text = $state(
		value === null ? '' : String(Number(fromBase(kind, value, initialUnit).toFixed(3)))
	);
	let message = $state('');

	function update() {
		const t = text.trim();
		if (t === '') {
			value = null;
			valid = true;
			message = '';
			return;
		}
		const n = Number(t.replace(',', '.'));
		if (!Number.isFinite(n) || (!allowNegative && n < 0)) {
			valid = false;
			message = allowNegative ? 'Enter a number' : 'Enter a positive number';
			return;
		}
		try {
			value = toBase(kind, n, unit);
			valid = true;
			message = '';
		} catch (err) {
			valid = false;
			message = err instanceof Error ? err.message : 'Invalid quantity';
		}
	}

	const units = $derived(unitsFor(kind));
</script>

<div class="flex gap-2">
	<input
		{id}
		class="input"
		inputmode="decimal"
		autocomplete="off"
		{placeholder}
		bind:value={text}
		oninput={update}
		aria-invalid={!valid}
	/>
	{#if units.length > 1}
		<select class="input w-24 shrink-0" bind:value={unit} onchange={update} aria-label="Unit">
			{#each units as u (u)}<option value={u}>{u}</option>{/each}
		</select>
	{:else}
		<span class="self-center text-sm text-slate-500">{unit}</span>
	{/if}
</div>
{#if message}<p class="field-error">{message}</p>{/if}
