<script lang="ts">
	import { FIELD_TYPES, newRow, slugifyKey, type FieldRow } from '#lib/field-editor.js';

	let {
		rows = $bindable(),
		errors = {},
		onrename
	}: {
		rows: FieldRow[];
		errors?: Record<number, Record<string, string>>;
		/** Rename a saved field (moves stored values); omitted when creating a category. */
		onrename?: (key: string) => void;
	} = $props();

	function add() {
		rows = [...rows, newRow()];
	}
	function remove(uid: number) {
		rows = rows.filter((r) => r.uid !== uid);
	}
	function move(index: number, by: number) {
		const next = [...rows];
		const [row] = next.splice(index, 1);
		next.splice(index + by, 0, row!);
		rows = next;
	}
	function labelChanged(row: FieldRow) {
		if (!row.savedKey && !row.keyEdited) row.key = slugifyKey(row.label);
	}
</script>

<div class="space-y-3">
	{#each rows as row, index (row.uid)}
		{@const e = errors[row.uid] ?? {}}
		<fieldset
			class="rounded-md border border-slate-200 p-3"
			data-testid="field-row"
			data-key={row.savedKey}
		>
			<legend class="px-1 text-xs text-slate-500">Field {index + 1}</legend>
			<div class="grid gap-3 sm:grid-cols-3">
				<div>
					<label class="label" for="f-label-{row.uid}">Label</label>
					<input
						id="f-label-{row.uid}"
						class="input"
						bind:value={row.label}
						oninput={() => labelChanged(row)}
						aria-invalid={!!e.label}
					/>
					{#if e.label}<p class="field-error">{e.label}</p>{/if}
				</div>
				<div>
					<label class="label" for="f-key-{row.uid}">Key</label>
					<div class="flex gap-1">
						<input
							id="f-key-{row.uid}"
							class="input font-mono"
							bind:value={row.key}
							oninput={() => (row.keyEdited = true)}
							disabled={!!row.savedKey}
							aria-invalid={!!e.key}
						/>
						{#if row.savedKey && onrename}
							<button type="button" class="btn btn-sm" onclick={() => onrename(row.savedKey!)}>
								Rename
							</button>
						{/if}
					</div>
					{#if e.key}<p class="field-error">{e.key}</p>{/if}
				</div>
				<div>
					<label class="label" for="f-type-{row.uid}">Type</label>
					<select id="f-type-{row.uid}" class="input" bind:value={row.type}>
						{#each FIELD_TYPES as t (t.value)}<option value={t.value}>{t.label}</option>{/each}
					</select>
				</div>
			</div>

			<div class="mt-3 grid gap-3 sm:grid-cols-3">
				{#if row.type === 'text'}
					<div>
						<label class="label" for="f-maxlen-{row.uid}">Max length</label>
						<input
							id="f-maxlen-{row.uid}"
							class="input"
							inputmode="numeric"
							bind:value={row.maxLength}
						/>
						{#if e.maxLength}<p class="field-error">{e.maxLength}</p>{/if}
					</div>
					<div class="sm:col-span-2">
						<label class="label" for="f-pattern-{row.uid}">Pattern (regular expression)</label>
						<input id="f-pattern-{row.uid}" class="input font-mono" bind:value={row.pattern} />
						{#if e.pattern}<p class="field-error">{e.pattern}</p>{/if}
					</div>
				{:else if row.type === 'number'}
					<div>
						<label class="label" for="f-min-{row.uid}">Minimum</label>
						<input id="f-min-{row.uid}" class="input" inputmode="decimal" bind:value={row.min} />
						{#if e.min}<p class="field-error">{e.min}</p>{/if}
					</div>
					<div>
						<label class="label" for="f-max-{row.uid}">Maximum</label>
						<input id="f-max-{row.uid}" class="input" inputmode="decimal" bind:value={row.max} />
						{#if e.max}<p class="field-error">{e.max}</p>{/if}
					</div>
					<label class="flex items-center gap-2 self-end pb-2 text-sm">
						<input type="checkbox" bind:checked={row.integer} /> Whole numbers only
					</label>
				{:else if row.type === 'quantity'}
					<div>
						<label class="label" for="f-unit-{row.uid}">Unit</label>
						<input
							id="f-unit-{row.uid}"
							class="input"
							placeholder="Ω, F, H, V…"
							bind:value={row.unit}
						/>
						{#if e.unit}<p class="field-error">{e.unit}</p>{/if}
					</div>
					<div class="sm:col-span-2">
						<label class="label" for="f-prefixes-{row.uid}">Allowed prefixes (optional)</label>
						<input
							id="f-prefixes-{row.uid}"
							class="input"
							placeholder="p, n, µ, m, k, M"
							bind:value={row.allowedPrefixes}
						/>
					</div>
				{:else if row.type === 'enum' || row.type === 'multi_enum'}
					<div class="sm:col-span-3">
						<label class="label" for="f-options-{row.uid}">Options (one per line)</label>
						<textarea id="f-options-{row.uid}" class="input" rows="3" bind:value={row.options}
						></textarea>
						{#if e.options}<p class="field-error">{e.options}</p>{/if}
					</div>
				{/if}
				<div class="sm:col-span-3">
					<label class="label" for="f-help-{row.uid}">Help text</label>
					<input id="f-help-{row.uid}" class="input" bind:value={row.help} />
				</div>
			</div>

			<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
				<label class="flex items-center gap-1.5">
					<input type="checkbox" bind:checked={row.required} /> Required
				</label>
				<label class="flex items-center gap-1.5">
					<input type="checkbox" bind:checked={row.filterable} /> Filterable
				</label>
				<label class="flex items-center gap-1.5">
					<input type="checkbox" bind:checked={row.showInList} /> Show in list
				</label>
				<label class="flex items-center gap-1.5">
					<input type="checkbox" bind:checked={row.searchable} /> Searchable
				</label>
				<span class="ml-auto flex gap-1">
					<button
						type="button"
						class="btn btn-sm"
						disabled={index === 0}
						onclick={() => move(index, -1)}
						aria-label="Move up"
					>
						↑
					</button>
					<button
						type="button"
						class="btn btn-sm"
						disabled={index === rows.length - 1}
						onclick={() => move(index, 1)}
						aria-label="Move down"
					>
						↓
					</button>
					<button type="button" class="btn btn-sm" onclick={() => remove(row.uid)}>Remove</button>
				</span>
			</div>
		</fieldset>
	{/each}
	<button type="button" class="btn" onclick={add}>+ Add field</button>
</div>
