<script lang="ts">
	import { resolve } from '$app/paths';
	import { ApiError } from '#lib/api.js';

	let { error }: { error: unknown } = $props();

	const message = $derived(error instanceof Error ? error.message : error ? String(error) : '');
	const violations = $derived(
		error instanceof ApiError &&
			error.code === 'field_change_conflict' &&
			Array.isArray(error.details)
			? (error.details as { sku: string; key: string }[])
			: []
	);
</script>

{#if error}
	<div role="alert" class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
		<p>{message}</p>
		{#if violations.length}
			<ul class="mt-2 list-inside list-disc">
				{#each violations as v (v.sku + v.key)}
					<li>
						<a class="underline" href={resolve('/items/[sku]', { sku: v.sku })}>{v.sku}</a>
						— field <code>{v.key}</code>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}
