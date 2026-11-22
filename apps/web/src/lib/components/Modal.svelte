<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		title,
		children,
		actions
	}: { open: boolean; title: string; children: Snippet; actions?: Snippet } = $props();

	let dialog = $state<HTMLDialogElement>();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});
</script>

<dialog
	bind:this={dialog}
	onclose={() => (open = false)}
	class="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-lg p-0 shadow-xl backdrop:bg-slate-900/40"
	aria-labelledby="modal-title"
>
	<div class="p-5">
		<h2 id="modal-title" class="mb-3 text-lg font-semibold">{title}</h2>
		{@render children()}
		{#if actions}
			<div class="mt-5 flex flex-wrap justify-end gap-2">{@render actions()}</div>
		{/if}
	</div>
</dialog>
