<script lang="ts">
	import './layout.css';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { api } from '#lib/api.js';
	import { formatDateTime } from '#lib/format.js';
	import { offline, startOfflineSupport } from '#lib/offline/status.svelte.js';
	import { applyUpdate, install, pwa, startPwa } from '#lib/pwa.svelte.js';
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
			href: resolve('/reports'),
			label: 'Reports',
			match: (p: string) => p.startsWith('/reports'),
			mobile: false
		},
		{
			href: resolve('/settings'),
			label: 'Settings',
			match: (p: string) => p.startsWith('/settings') || p.startsWith('/import'),
			mobile: false
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
	const signedIn = $derived(!data.session.authRequired || data.session.authenticated);

	onMount(startPwa);

	// Offline catalogue and outbox sync run while signed in.
	$effect(() => {
		if (signedIn) return startOfflineSupport();
	});
</script>

<svelte:head>
	<title>Inventory</title>
</svelte:head>

<div class="min-h-dvh bg-slate-50 pb-16 text-slate-900 sm:pb-0 print:bg-white print:pb-0">
	{#if showChrome}
		<header
			class="sticky top-0 z-10 print:hidden border-b border-slate-200 bg-white/95 backdrop-blur"
		>
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
					{#if offline.pending > 0 || offline.failed > 0}
						<a
							href={resolve('/sync')}
							class="rounded-full px-2.5 py-1 text-xs font-medium {offline.failed > 0
								? 'bg-red-100 text-red-800'
								: 'bg-amber-100 text-amber-900'}"
							data-testid="outbox-badge"
						>
							{offline.failed > 0
								? `${offline.failed} failed`
								: `${offline.pending} change${offline.pending === 1 ? '' : 's'} to send`}
						</a>
					{/if}
					{#if pwa.canInstall}
						<button class="btn btn-sm hidden sm:inline-flex" onclick={install}>Install app</button>
					{/if}
					{#if data.session.authRequired}
						<button class="btn btn-sm" onclick={logout}>Log out</button>
					{/if}
				</div>
			</div>
		</header>
		{#if !offline.reachable}
			<div
				class="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900 print:hidden"
				role="status"
				data-testid="offline-banner"
			>
				Offline: showing data saved {offline.syncedAt
					? formatDateTime(offline.syncedAt)
					: 'earlier'}. Stock changes are kept and sent when the server is back.
			</div>
		{/if}
	{/if}

	<main class="mx-auto max-w-6xl px-4 py-6">
		{@render children()}
	</main>

	{#if showChrome}
		<nav
			class="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 print:hidden border-t border-slate-200 bg-white sm:hidden"
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

	{#if pwa.updateReady}
		<div
			class="fixed inset-x-4 bottom-20 z-30 mx-auto flex max-w-md items-center gap-3 rounded-lg bg-slate-900 p-3 pl-4 text-sm text-white shadow-lg sm:bottom-4 print:hidden"
			role="status"
		>
			<span>A new version of the app is ready.</span>
			<button class="btn btn-sm ml-auto" onclick={applyUpdate}>Reload</button>
		</div>
	{/if}
</div>
