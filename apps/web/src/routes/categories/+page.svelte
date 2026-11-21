<script lang="ts">
	import { resolve } from '$app/paths';
	import { flattenTree } from '#lib/tree.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const entries = $derived(flattenTree(data.categories));
</script>

<div class="mb-4 flex items-center justify-between gap-2">
	<h1 class="text-2xl font-bold">Categories</h1>
	<a class="btn btn-primary" href={resolve('/categories/new')}>+ New category</a>
</div>

{#if entries.length === 0}
	<p class="card text-center text-slate-500">
		No categories yet. Create one to start adding items.
	</p>
{:else}
	<ul class="card divide-y divide-slate-100 p-0">
		{#each entries as { node, depth } (node.id)}
			<li
				class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
				style:padding-left="{1 + depth * 1.5}rem"
			>
				<a class="link font-medium" href={resolve('/categories/[id]', { id: String(node.id) })}>
					{node.name}
				</a>
				{#if node.skuPrefix}<code class="text-xs text-slate-500">{node.skuPrefix}</code>{/if}
				<span class="badge">{node.displayUnit}</span>
				<span class="text-xs text-slate-500">
					{node.fieldDefs.length} field{node.fieldDefs.length === 1
						? ''
						: 's'}{#if node.resolvedFieldDefs.length > node.fieldDefs.length}
						+ {node.resolvedFieldDefs.length - node.fieldDefs.length} inherited{/if}
				</span>
				<a class="link ml-auto text-sm" href={resolve(`/items?category=${node.id}`)}>Items</a>
			</li>
		{/each}
	</ul>
{/if}
