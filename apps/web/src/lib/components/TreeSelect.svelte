<script lang="ts">
	import { flattenTree, type TreeNode } from '#lib/tree.js';

	let {
		nodes,
		value = $bindable(null),
		placeholder = '—',
		allowNull = true,
		exclude,
		id,
		disabled = false,
		onchange
	}: {
		nodes: TreeNode[];
		value: number | null;
		placeholder?: string;
		allowNull?: boolean;
		exclude?: Set<number>;
		id?: string;
		disabled?: boolean;
		onchange?: (value: number | null) => void;
	} = $props();

	const entries = $derived(flattenTree(nodes).filter((e) => !exclude?.has(e.node.id)));
</script>

<select {id} class="input" bind:value {disabled} onchange={() => onchange?.(value)}>
	{#if allowNull}
		<option value={null}>{placeholder}</option>
	{/if}
	{#each entries as entry (entry.node.id)}
		<option value={entry.node.id}>{'   '.repeat(entry.depth)}{entry.node.name}</option>
	{/each}
</select>
