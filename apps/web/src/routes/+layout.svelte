<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { api } from '#lib/api.js';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const nav = [
		{ href: resolve('/'), label: 'Home', match: (p: string) => p === '/' },
		{ href: resolve('/items'), label: 'Items', match: (p: string) => p.startsWith('/items') },
		{ href: resolve('/scan'), label: 'Scan', match: (p: string) => p.startsWith('/scan') },
		{
			href: resolve('/projects'),
			label: 'Projects',
			match: (p: string) => p.startsWith('/projects')
		},
		{
			href: resolve('/categories'),
			label: 'Categories',
			// Not in the phone bar (six items do not fit); reachable from the dashboard.
			mobile: false,
			match: (p: string) => p.startsWith('/categories')
		},
		{
			href: resolve('/locations'),
			label: 'Locations',
			match: (p: string) => p.startsWith('/locations')
		}
	];

	async function logout() {
		await api.logout();
		await invalidateAll();
		await goto(resolve('/login'));
	}

	const showChrome = $derived(page.url.pathname !== '/login');
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Inventory</title>
</svelte:head>

<div class="min-h-dvh bg-slate-50 pb-16 text-slate-900 sm:pb-0">
	{#if showChrome}
		<header class="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
			<div class="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
				<a href={resolve('/')} class="text-lg font-semibold">Inventory</a>
				<nav class="hidden gap-1 sm:flex" aria-label="Main">
					{#each nav as item (item.href)}
						<a
							href={item.href}
							class="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-slate-100"
							class:bg-slate-100={item.match(page.url.pathname)}
							aria-current={item.match(page.url.pathname) ? 'page' : undefined}
						>
							{item.label}
						</a>
					{/each}
				</nav>
				<div class="ml-auto flex items-center gap-2">
					{#if data.session.authRequired}
						<button class="btn btn-sm" onclick={logout}>Log out</button>
					{/if}
				</div>
			</div>
		</header>
	{/if}

	<main class="mx-auto max-w-6xl px-4 py-6">
		{@render children()}
	</main>

	{#if showChrome}
		<nav
			class="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t border-slate-200 bg-white sm:hidden"
			aria-label="Main"
		>
			{#each nav.filter((n) => n.mobile !== false) as item (item.href)}
				<a
					href={item.href}
					class="py-3 text-center text-xs font-medium"
					class:text-blue-700={item.match(page.url.pathname)}
					aria-current={item.match(page.url.pathname) ? 'page' : undefined}
				>
					{item.label}
				</a>
			{/each}
		</nav>
	{/if}
</div>
