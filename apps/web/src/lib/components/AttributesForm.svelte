<script lang="ts">
	import type { ResolvedFieldDef } from '@inventory/shared';
	import type { FormValues } from '#lib/attribute-form.js';
	import AttributeInput from './AttributeInput.svelte';

	let {
		defs,
		values = $bindable(),
		errors = {}
	}: { defs: ResolvedFieldDef[]; values: FormValues; errors?: Record<string, string> } = $props();
</script>

{#if defs.length === 0}
	<p class="text-sm text-slate-500">This category has no custom fields.</p>
{:else}
	<div class="grid gap-4 sm:grid-cols-2">
		{#each defs as def (def.key)}
			<div>
				<label class="label" for="attr-{def.key}">
					{def.label}{#if def.required}<span class="text-red-600"> *</span>{/if}
				</label>
				<AttributeInput
					{def}
					id="attr-{def.key}"
					bind:value={values[def.key]}
					error={errors[def.key]}
				/>
			</div>
		{/each}
	</div>
{/if}
