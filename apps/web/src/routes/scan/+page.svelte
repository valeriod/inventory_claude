<script lang="ts">
	import type { CategoryWithFields, ItemWithAvailability } from '@inventory/shared';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { api, ApiError, type StockChangeResponse } from '#lib/api.js';
	import ErrorAlert from '#lib/components/ErrorAlert.svelte';
	import Scanner from '#lib/components/Scanner.svelte';
	import StockDialog, { type StockMode } from '#lib/components/StockDialog.svelte';
	import { formatQty } from '#lib/format.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const MODES = [
		{ id: 'lookup', label: 'Look up', hint: 'Scan to open the item or bin.' },
		{ id: 'adjust', label: 'Adjust', hint: 'Scan an item, then add or remove stock.' },
		{ id: 'receive', label: 'Receive', hint: 'Scan to add stock; unknown barcodes create an item.' }
	] as const;
	type Mode = (typeof MODES)[number]['id'];

	const mode = $derived<Mode>(
		MODES.find((m) => m.id === page.url.searchParams.get('mode'))?.id ?? 'lookup'
	);

	type Message =
		| { kind: 'info'; text: string }
		| { kind: 'unknown'; code: string }
		| { kind: 'error'; error: unknown };

	let busy = $state(false);
	let message = $state<Message | null>(null);
	let manual = $state('');
	let stock = $state<{
		item: ItemWithAvailability;
		category: CategoryWithFields;
		mode: StockMode;
	} | null>(null);
	let stockOpen = $state(false);
	let recent = $state<{ id: number; sku: string; name: string; text: string }[]>([]);
	let nextId = 0;

	const paused = $derived(busy || stockOpen);

	/** Our own label URLs (…/i/SKU, …/l/CODE) as opposed to manufacturer barcodes. */
	const isLabelUrl = (code: string) => /^https?:\/\//i.test(code) || code.startsWith('/');

	async function handle(code: string) {
		if (busy || stockOpen) return;
		busy = true;
		message = null;
		try {
			const result = await api.lookup(code);
			if (result.type === 'item') {
				const { item } = result;
				if (mode === 'lookup') {
					await goto(resolve('/items/[sku]', { sku: item.sku }));
					return;
				}
				const category = data.categories.find((c) => c.id === item.categoryId);
				if (!category) throw new Error(`Category of ${item.sku} not found; reload the page`);
				stock = { item, category, mode: mode === 'receive' ? 'receive' : 'adjust' };
				stockOpen = true;
			} else if (result.type === 'location') {
				const { location } = result;
				if (mode === 'lookup') {
					await goto(resolve(`/items?location=${location.id}`));
					return;
				}
				message = {
					kind: 'info',
					text: `That is the label of bin ${location.code} (${location.name}). Scan an item instead.`
				};
			} else {
				message = {
					kind: 'info',
					text: `That is the label of project “${result.project.name}”. Project pages are not available yet.`
				};
			}
		} catch (err) {
			if (err instanceof ApiError && err.status === 404) {
				if (isLabelUrl(code)) {
					message = { kind: 'info', text: `No item or bin matches this label: ${code}` };
				} else if (mode === 'receive') {
					await goto(resolve(`/items/new?barcode=${encodeURIComponent(code)}`));
					return;
				} else {
					message = { kind: 'unknown', code };
				}
			} else {
				message = { kind: 'error', error: err };
			}
		} finally {
			busy = false;
		}
	}

	function stockDone(result: StockChangeResponse) {
		if (!stock) return;
		const { item, category } = stock;
		const delta = result.movement?.delta ?? 0;
		const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
		recent = [
			{
				id: nextId++,
				sku: item.sku,
				name: item.name,
				text: `${sign}${formatQty(Math.abs(delta), category)} → ${formatQty(result.qtyOnHand, category)}`
			},
			...recent
		].slice(0, 10);
	}

	function submitManual(e: SubmitEvent) {
		e.preventDefault();
		const code = manual.trim();
		if (!code) return;
		manual = '';
		void handle(code);
	}
</script>

<h1 class="mb-4 text-2xl font-bold">Scan</h1>

<nav class="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-slate-200 p-1" aria-label="Scan mode">
	{#each MODES as m (m.id)}
		<a
			href={resolve(`/scan?mode=${m.id}`)}
			data-sveltekit-replacestate
			class="rounded-md py-1.5 text-center text-sm font-medium"
			class:bg-white={mode === m.id}
			class:shadow-sm={mode === m.id}
			aria-current={mode === m.id ? 'page' : undefined}
		>
			{m.label}
		</a>
	{/each}
</nav>
<p class="mb-3 text-sm text-slate-600">{MODES.find((m) => m.id === mode)?.hint}</p>

<Scanner onscan={(d) => handle(d.text)} {paused} />

<form class="mt-3 flex gap-2" onsubmit={submitManual}>
	<input
		class="input font-mono"
		placeholder="Type a code, or use a USB scanner"
		aria-label="Code"
		enterkeyhint="go"
		autocomplete="off"
		autocapitalize="off"
		spellcheck="false"
		bind:value={manual}
	/>
	<button class="btn" disabled={busy}>Go</button>
</form>

<div class="mt-4 space-y-3" aria-live="polite">
	{#if busy}
		<p class="text-sm text-slate-500">Looking up…</p>
	{/if}
	{#if message?.kind === 'info'}
		<p class="card text-sm" data-testid="scan-message">{message.text}</p>
	{:else if message?.kind === 'unknown'}
		<div class="card space-y-2 text-sm" data-testid="scan-message">
			<p>
				No item has the code <span class="font-mono font-semibold">{message.code}</span>.
			</p>
			<a
				class="btn btn-primary btn-sm"
				href={resolve(`/items/new?barcode=${encodeURIComponent(message.code)}`)}
			>
				Create an item with this barcode
			</a>
		</div>
	{:else if message?.kind === 'error'}
		<ErrorAlert error={message.error} />
	{/if}

	{#if recent.length > 0}
		<section class="card">
			<h2 class="mb-2 text-sm font-semibold">This session</h2>
			<ul class="divide-y divide-slate-100 text-sm">
				{#each recent as r (r.id)}
					<li class="flex items-baseline gap-2 py-1.5">
						<a class="link font-mono" href={resolve('/items/[sku]', { sku: r.sku })}>{r.sku}</a>
						<span class="truncate text-slate-600">{r.name}</span>
						<span class="ml-auto font-medium whitespace-nowrap tabular-nums">{r.text}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

{#if stock}
	<StockDialog
		bind:open={stockOpen}
		mode={stock.mode}
		item={stock.item}
		category={stock.category}
		ondone={stockDone}
	/>
{/if}
