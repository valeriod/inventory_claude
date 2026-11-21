<script lang="ts">
	let {
		page,
		pageSize,
		total,
		href
	}: { page: number; pageSize: number; total: number; href: (page: number) => string } = $props();

	const pages = $derived(Math.max(1, Math.ceil(total / pageSize)));
	const from = $derived(total === 0 ? 0 : (page - 1) * pageSize + 1);
	const to = $derived(Math.min(total, page * pageSize));
</script>

<nav class="flex items-center justify-between gap-2 text-sm" aria-label="Pagination">
	<span class="text-slate-600">{from}–{to} of {total}</span>
	<div class="flex gap-2">
		{#if page > 1}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href() returns a resolved URL -->
			<a class="btn btn-sm" href={href(page - 1)}>Previous</a>
		{/if}
		{#if page < pages}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- href() returns a resolved URL -->
			<a class="btn btn-sm" href={href(page + 1)}>Next</a>
		{/if}
	</div>
</nav>
