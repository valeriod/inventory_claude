<script lang="ts">
	import {
		unitsFor,
		type CategoryWithFields,
		type CreateCategoryRequest,
		type UnitKind
	} from '@inventory/shared';
	import { fromRows, toRows } from '#lib/field-editor.js';
	import { descendantIds } from '#lib/tree.js';
	import ErrorAlert from './ErrorAlert.svelte';
	import FieldDefEditor from './FieldDefEditor.svelte';
	import Modal from './Modal.svelte';
	import TreeSelect from './TreeSelect.svelte';

	let {
		category,
		categories,
		onsave,
		onrename
	}: {
		/** Existing category when editing; undefined when creating. */
		category?: CategoryWithFields;
		categories: CategoryWithFields[];
		onsave: (payload: Required<CreateCategoryRequest>) => Promise<void>;
		onrename?: (key: string) => void;
	} = $props();

	// Form state is initialised once from the props; the parent re-keys this component to reset it.
	// svelte-ignore state_referenced_locally
	const initial = category;
	let name = $state(initial?.name ?? '');
	let parentId = $state<number | null>(initial?.parentId ?? null);
	let skuPrefix = $state(initial?.skuPrefix ?? '');
	let unitKind = $state<UnitKind>(initial?.unitKind ?? 'count');
	let displayUnit = $state(initial?.displayUnit ?? 'pcs');
	let rows = $state(toRows(initial?.fieldDefs ?? []));

	let rowErrors = $state<Record<number, Record<string, string>>>({});
	let fieldErrors = $state<Record<string, string>>({});
	let error = $state<unknown>(null);
	let busy = $state(false);
	let confirmRemoval = $state(false);

	const exclude = $derived(initial ? descendantIds(categories, initial.id) : undefined);
	const inherited = $derived(initial?.resolvedFieldDefs.filter((d) => d.inherited) ?? []);
	const units = $derived(unitsFor(unitKind));
	const removedKeys = $derived.by(() => {
		const kept = new Set(rows.map((r) => r.savedKey).filter(Boolean));
		return (initial?.fieldDefs ?? []).map((d) => d.key).filter((k) => !kept.has(k));
	});
	const categoryName = (id: number) => categories.find((c) => c.id === id)?.name ?? `#${id}`;

	function kindChanged() {
		if (!units.includes(displayUnit)) displayUnit = units[0]!;
	}

	async function submit(e?: SubmitEvent, confirmed = false) {
		e?.preventDefault();
		error = null;
		fieldErrors = {};
		const { defs, errors } = fromRows(rows);
		rowErrors = errors;
		if (!name.trim()) fieldErrors = { name: 'Enter a name' };
		if (Object.keys(errors).length || !name.trim()) {
			error = new Error('Please fix the highlighted fields');
			return;
		}
		if (removedKeys.length && !confirmed) {
			confirmRemoval = true;
			return;
		}
		confirmRemoval = false;
		busy = true;
		try {
			await onsave({
				name: name.trim(),
				parentId,
				skuPrefix: skuPrefix.trim() || null,
				unitKind,
				displayUnit,
				fieldDefs: defs
			});
		} catch (err) {
			error = err;
			const fe = (err as { fieldErrors?: Record<string, string> }).fieldErrors;
			if (fe) fieldErrors = fe;
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={submit} class="space-y-6" novalidate>
	<section class="card grid gap-4 sm:grid-cols-2">
		<div>
			<label class="label" for="cat-name">Name</label>
			<input id="cat-name" class="input" bind:value={name} aria-invalid={!!fieldErrors.name} />
			{#if fieldErrors.name}<p class="field-error">{fieldErrors.name}</p>{/if}
		</div>
		<div>
			<label class="label" for="cat-parent">Parent category</label>
			<TreeSelect
				id="cat-parent"
				nodes={categories}
				bind:value={parentId}
				placeholder="— none (top level) —"
				{exclude}
			/>
		</div>
		<div>
			<label class="label" for="cat-prefix">SKU prefix</label>
			<input
				id="cat-prefix"
				class="input font-mono"
				placeholder="e.g. RES-"
				bind:value={skuPrefix}
			/>
			<p class="mt-1 text-xs text-slate-500">New items get SKUs like {skuPrefix || 'RES-'}0001.</p>
			{#if fieldErrors.skuPrefix}<p class="field-error">{fieldErrors.skuPrefix}</p>{/if}
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label class="label" for="cat-kind">Measured by</label>
				<select id="cat-kind" class="input" bind:value={unitKind} onchange={kindChanged}>
					<option value="count">Count</option>
					<option value="length">Length</option>
					<option value="mass">Mass</option>
					<option value="volume">Volume</option>
				</select>
			</div>
			<div>
				<label class="label" for="cat-unit">Display unit</label>
				<select id="cat-unit" class="input" bind:value={displayUnit}>
					{#each units as u (u)}<option value={u}>{u}</option>{/each}
				</select>
			</div>
		</div>
	</section>

	{#if inherited.length}
		<section class="card">
			<h2 class="mb-2 font-semibold">Inherited fields</h2>
			<ul class="space-y-1 text-sm">
				{#each inherited as def (def.key)}
					<li>
						<span class="font-medium">{def.label}</span>
						<code class="text-xs text-slate-500">{def.key}</code>
						<span class="badge">{def.type}</span>
						<span class="text-slate-500">from {categoryName(def.categoryId)}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<section class="card">
		<h2 class="mb-3 font-semibold">Fields</h2>
		<FieldDefEditor bind:rows errors={rowErrors} {onrename} />
	</section>

	<ErrorAlert {error} />
	<div class="flex justify-end">
		<button type="submit" class="btn btn-primary" disabled={busy}>
			{initial ? 'Save changes' : 'Create category'}
		</button>
	</div>
</form>

<Modal bind:open={confirmRemoval} title="Remove fields?">
	<p class="text-sm">
		These fields will be removed: <strong>{removedKeys.join(', ')}</strong>. Values already stored
		on items are kept but hidden, and come back if a field with the same key is added again.
	</p>
	{#snippet actions()}
		<button type="button" class="btn" onclick={() => (confirmRemoval = false)}>Cancel</button>
		<button type="button" class="btn btn-danger" onclick={() => submit(undefined, true)}>
			Remove and save
		</button>
	{/snippet}
</Modal>
