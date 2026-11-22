<script lang="ts">
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { formatDateTime, formatQty } from '#lib/format.js';
	import { discard, outboxEntries, retry, type OutboxEntry } from '#lib/offline/outbox.js';
	import { offline, refreshOfflineState, syncNow } from '#lib/offline/status.svelte.js';
	import { install, isIosSafari, pwa } from '#lib/pwa.svelte.js';

	let entries = $state<OutboxEntry[]>([]);

	async function load() {
		entries = await outboxEntries().catch(() => []);
		await refreshOfflineState();
	}

	async function sync() {
		await syncNow(true);
		await load();
	}

	async function act(action: () => Promise<void>) {
		await action();
		await load();
	}

	function describe(entry: OutboxEntry): string {
		const qty = (n: number) => formatQty(n, entry.unit);
		if (entry.kind === 'count') return `Count: ${qty(entry.body.countedQty)}`;
		const { reason, delta } = entry.body;
		const verb = reason === 'receive' ? 'Receive' : reason === 'consume' ? 'Use' : 'Adjust';
		return `${verb} ${delta > 0 ? '+' : '−'}${qty(Math.abs(delta))}`;
	}

	onMount(() => {
		void load();
	});

	// Reload the list when a background sync changes the counts.
	$effect(() => {
		void offline.pending;
		void offline.failed;
		void outboxEntries()
			.then((e) => (entries = e))
			.catch(() => {});
	});
</script>

<svelte:head><title>Offline & sync · Inventory</title></svelte:head>

<h1 class="mb-4 text-2xl font-bold">Offline & sync</h1>

<section class="card mb-4 space-y-2 text-sm" aria-labelledby="offline-heading">
	<h2 id="offline-heading" class="font-semibold">Offline copy</h2>
	<p>
		{#if offline.syncedAt}
			<span data-testid="synced-at">
				{offline.items} items saved {formatDateTime(offline.syncedAt)}
			</span>.
		{:else}
			Nothing saved yet.
		{/if}
		Without a connection you can browse and search items, look up and scan codes, and record stock changes;
		they are sent when the server is reachable again.
	</p>
	<p class="text-slate-600">
		Status: {offline.reachable ? 'connected' : 'offline'}{offline.syncing ? ' · syncing…' : ''}
	</p>
	{#if offline.error}<p class="field-error">{offline.error}</p>{/if}
	<button class="btn btn-sm" onclick={sync} disabled={offline.syncing}>Sync now</button>
</section>

<section class="card mb-4" aria-labelledby="outbox-heading">
	<h2 id="outbox-heading" class="mb-2 font-semibold">Changes waiting to be sent</h2>
	{#if offline.needsLogin}
		<p class="mb-2 text-sm text-amber-800">
			Your session has expired. <a class="link" href={resolve('/login')}>Log in</a> to send these changes.
		</p>
	{/if}
	{#if entries.length === 0}
		<p class="text-sm text-slate-500" data-testid="outbox-empty">Nothing waiting.</p>
	{:else}
		<ul class="divide-y divide-slate-100 text-sm" data-testid="outbox">
			{#each entries as entry (entry.id)}
				<li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
					<a class="link font-mono" href={resolve('/items/[sku]', { sku: entry.sku })}>
						{entry.sku}
					</a>
					<span class="text-slate-600">{entry.itemName}</span>
					<span>{describe(entry)}</span>
					<span class="text-xs text-slate-500">{formatDateTime(entry.createdAt)}</span>
					{#if entry.status === 'failed'}
						<span class="w-full text-xs text-red-700">Not applied: {entry.error}</span>
					{/if}
					<span class="ml-auto flex gap-1">
						{#if entry.status === 'failed'}
							<button class="btn btn-sm" onclick={() => act(() => retry(entry.id))}>Retry</button>
						{/if}
						<button class="btn btn-sm" onclick={() => act(() => discard(entry.id))}>Discard</button>
					</span>
				</li>
			{/each}
		</ul>
		{#if entries.some((e) => e.status === 'failed')}
			<p class="mt-2 text-xs text-slate-500">
				Failed changes were refused by the server (for example, not enough stock any more). Fix the
				cause and retry, or discard them.
			</p>
		{/if}
	{/if}
</section>

<section class="card text-sm" aria-labelledby="install-heading">
	<h2 id="install-heading" class="mb-2 font-semibold">Install</h2>
	{#if pwa.standalone}
		<p>The app is installed.</p>
	{:else if pwa.canInstall}
		<p class="mb-2">Install the app for a home-screen icon and full-screen use.</p>
		<button class="btn btn-sm btn-primary" onclick={install}>Install app</button>
	{:else if isIosSafari()}
		<p>On iPhone or iPad: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</p>
	{:else}
		<p>Use your browser's "Install app" or "Add to Home screen" menu item.</p>
	{/if}
</section>
