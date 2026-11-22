<script lang="ts">
	import {
		DEFAULT_LABEL_LAYOUT,
		LABEL_LAYOUTS,
		labelLayout,
		labelsPerPage,
		MAX_LABELS
	} from '@inventory/shared';
	import { api } from '#lib/api.js';
	import Modal from './Modal.svelte';

	let {
		open = $bindable(false),
		skus = [],
		locations = [],
		projects = []
	}: {
		open: boolean;
		/** Item SKUs to print. */
		skus?: string[];
		/** Location codes to print. */
		locations?: string[];
		/** Project ids to print. */
		projects?: number[];
	} = $props();

	const LAYOUT_KEY = 'inventory.labels.layout';

	function savedLayout(): string {
		try {
			const saved = localStorage.getItem(LAYOUT_KEY);
			if (saved && labelLayout(saved)) return saved;
		} catch {
			// Storage unavailable; use the default.
		}
		return DEFAULT_LABEL_LAYOUT;
	}

	let layoutId = $state(savedLayout());
	let skip = $state(0);
	let outline = $state(false);
	let info = $state<{ baseUrl: string; configured: boolean } | null>(null);

	const layout = $derived(labelLayout(layoutId)!);
	const perPage = $derived(labelsPerPage(layout));
	const count = $derived(skus.length + locations.length + projects.length);
	const pages = $derived(Math.ceil((count + (perPage > 1 ? skip : 0)) / perPage));

	$effect(() => {
		if (open && !info)
			api.labelInfo().then(
				(i) => (info = i),
				() => {}
			);
	});

	$effect(() => {
		if (skip >= perPage) skip = 0;
	});

	function print() {
		try {
			localStorage.setItem(LAYOUT_KEY, layoutId);
		} catch {
			// ignore
		}
		window.open(
			api.labelsUrl({
				skus,
				locations,
				projects,
				layout: layoutId,
				skip: perPage > 1 ? skip : 0,
				outline
			}),
			'_blank',
			'noopener'
		);
		open = false;
	}
</script>

<Modal bind:open title={count === 1 ? 'Print label' : `Print ${count} labels`}>
	<div class="space-y-4">
		<div>
			<label class="label" for="label-layout">Label stock</label>
			<select id="label-layout" class="input" bind:value={layoutId}>
				{#each LABEL_LAYOUTS as l (l.id)}
					<option value={l.id}>{l.name}</option>
				{/each}
			</select>
		</div>
		{#if perPage > 1}
			<div>
				<label class="label" for="label-skip">Skip positions already used on the sheet</label>
				<input
					id="label-skip"
					class="input w-28"
					type="number"
					min="0"
					max={perPage - 1}
					bind:value={skip}
				/>
				<p class="mt-1 text-xs text-slate-500">
					Labels fill the sheet row by row from the top left.
				</p>
			</div>
		{/if}
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" bind:checked={outline} />
			Draw outlines (test print on plain paper)
		</label>
		<p class="text-sm text-slate-600">
			{count} label{count === 1 ? '' : 's'} on {pages} page{pages === 1 ? '' : 's'}. Print at 100%
			scale ("actual size"), not "fit to page".
		</p>
		{#if count > MAX_LABELS}
			<p class="field-error">At most {MAX_LABELS} labels can be printed at once.</p>
		{/if}
		{#if info && !info.configured}
			<p class="rounded-md bg-amber-50 p-3 text-sm text-amber-900" role="note">
				The QR codes will link to <span class="font-mono">{info.baseUrl}</span>. Set
				<span class="font-mono">PUBLIC_URL</span> on the server to the address you use on your phone before
				printing labels you intend to keep.
			</p>
		{/if}
	</div>
	{#snippet actions()}
		<button type="button" class="btn" onclick={() => (open = false)}>Cancel</button>
		<button
			type="button"
			class="btn btn-primary"
			disabled={count === 0 || count > MAX_LABELS}
			onclick={print}
		>
			Open PDF
		</button>
	{/snippet}
</Modal>
