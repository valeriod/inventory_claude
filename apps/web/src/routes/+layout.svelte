<script lang="ts">
	import './layout.css';
	import { resolve } from '$app/paths';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Inventory</title>
</svelte:head>

<div class="min-h-dvh bg-slate-50 text-slate-900">
	<header class="border-b border-slate-200 bg-white">
		<div class="mx-auto max-w-5xl px-4 py-3">
			<a href={resolve('/')} class="text-lg font-semibold">Inventory</a>
		</div>
	</header>
	<main class="mx-auto max-w-5xl px-4 py-6">
		{@render children()}
	</main>
</div>
