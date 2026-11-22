<script lang="ts">
	import type { FieldDef } from '@inventory/shared';
	import type { FormValue } from '#lib/attribute-form.js';

	let {
		def,
		value = $bindable(),
		error,
		id
	}: { def: FieldDef; value: FormValue | undefined; error?: string; id: string } = $props();

	const text = $derived(typeof value === 'string' ? value : '');
	const selected = $derived(Array.isArray(value) ? value : []);

	function toggle(option: string, checked: boolean) {
		value = checked ? [...selected, option] : selected.filter((o) => o !== option);
	}
</script>

{#if def.type === 'enum'}
	<select
		{id}
		class="input"
		value={text}
		onchange={(e) => (value = e.currentTarget.value)}
		aria-invalid={!!error}
	>
		<option value="">{def.required ? 'Select…' : '—'}</option>
		{#each def.options as option (option)}<option value={option}>{option}</option>{/each}
	</select>
{:else if def.type === 'boolean'}
	<select
		{id}
		class="input"
		value={text}
		onchange={(e) => (value = e.currentTarget.value)}
		aria-invalid={!!error}
	>
		<option value="">{def.required ? 'Select…' : '—'}</option>
		<option value="true">Yes</option>
		<option value="false">No</option>
	</select>
{:else if def.type === 'multi_enum'}
	<div {id} class="flex flex-wrap gap-x-4 gap-y-1" role="group">
		{#each def.options as option (option)}
			<label class="inline-flex items-center gap-1.5 text-sm">
				<input
					type="checkbox"
					checked={selected.includes(option)}
					onchange={(e) => toggle(option, e.currentTarget.checked)}
				/>
				{option}
			</label>
		{/each}
	</div>
{:else if def.type === 'quantity'}
	<div class="flex items-center gap-2">
		<input
			{id}
			class="input"
			autocomplete="off"
			placeholder="e.g. 4.7k"
			value={text}
			oninput={(e) => (value = e.currentTarget.value)}
			aria-invalid={!!error}
		/>
		<span class="text-sm text-slate-500">{def.unit}</span>
	</div>
{:else}
	<input
		{id}
		class="input"
		type={def.type === 'date' ? 'date' : def.type === 'url' ? 'url' : 'text'}
		inputmode={def.type === 'number' ? 'decimal' : undefined}
		autocomplete="off"
		value={text}
		oninput={(e) => (value = e.currentTarget.value)}
		aria-invalid={!!error}
	/>
{/if}
{#if def.help}<p class="mt-1 text-xs text-slate-500">{def.help}</p>{/if}
{#if error}<p class="field-error">{error}</p>{/if}
