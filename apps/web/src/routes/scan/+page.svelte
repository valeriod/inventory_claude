<script lang="ts">
	import type {
		CategoryWithFields,
		ItemWithAvailability,
		Location,
		PickLine
	} from '@inventory/shared';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { api, ApiError, type StockChangeResponse } from '#lib/api.js';
	import ErrorAlert from '#lib/components/ErrorAlert.svelte';
	import ReservationDialog from '#lib/components/ReservationDialog.svelte';
	import Scanner from '#lib/components/Scanner.svelte';
	import StockDialog, { type StockMode } from '#lib/components/StockDialog.svelte';
	import { formatQty } from '#lib/format.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const MODES = [
		{ id: 'lookup', label: 'Look up', hint: 'Scan to open the item or bin.' },
		{ id: 'adjust', label: 'Adjust', hint: 'Scan an item, then add or remove stock.' },
		{
			id: 'receive',
			label: 'Receive',
			hint: 'Scan to add stock; unknown barcodes create an item.'
		},
		{
			id: 'stocktake',
			label: 'Stocktake',
			hint: 'Scan a bin label, then each item in it, and enter what you count.'
		}
	] as const;
	type Mode = (typeof MODES)[number]['id'] | 'pick';

	/** Pick mode needs a project (opened from a project page). */
	const mode = $derived<Mode>(
		data.project
			? 'pick'
			: (MODES.find((m) => m.id === page.url.searchParams.get('mode'))?.id ?? 'lookup')
	);
	const toPick = $derived(data.lines?.filter((l) => l.status === 'reserved') ?? []);

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
	let pickLine = $state<{ line: PickLine; category: CategoryWithFields } | null>(null);
	let pickOpen = $state(false);
	let recent = $state<{ id: number; sku: string; name: string; text: string }[]>([]);

	// Stocktake: the bin being counted, what the inventory says is in it, and what was counted.
	let bin = $state<Location | null>(null);
	let binItems = $state<ItemWithAvailability[]>([]);
	let counted = $state<Record<string, number>>({});
	let strays = $state<ItemWithAvailability[]>([]);
	const countedInBin = $derived(binItems.filter((i) => i.sku in counted).length);

	async function openBin(location: Location) {
		const list = await api.items.list(`location=${location.id}&sublocations=false&pageSize=200`);
		bin = location;
		binItems = list.items;
		counted = {};
		strays = [];
		message = { kind: 'info', text: `Counting bin ${location.code}. Scan each item in it.` };
	}

	async function moveHere(item: ItemWithAvailability) {
		if (!bin) return;
		try {
			const moved = await api.items.update(item.sku, { locationId: bin.id });
			strays = strays.filter((s) => s.sku !== item.sku);
			binItems = [...binItems, moved];
		} catch (err) {
			message = { kind: 'error', error: err };
		}
	}
	let nextId = 0;

	const paused = $derived(busy || stockOpen || pickOpen);

	/** Our own label URLs (…/i/SKU, …/l/CODE) as opposed to manufacturer barcodes. */
	const isLabelUrl = (code: string) => /^https?:\/\//i.test(code) || code.startsWith('/');

	async function handle(code: string) {
		if (busy || stockOpen || pickOpen) return;
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
				if (mode === 'pick') {
					const line = toPick.find((l) => l.sku === item.sku);
					if (line) {
						pickLine = { line, category };
						pickOpen = true;
					} else {
						message = {
							kind: 'info',
							text: `${item.sku} (${item.name}) is not reserved for this project.`
						};
					}
					return;
				}
				if (mode === 'stocktake') {
					if (!bin) {
						message = { kind: 'info', text: 'Scan the label of the bin you are counting first.' };
						return;
					}
					if (
						!binItems.some((i) => i.sku === item.sku) &&
						!strays.some((i) => i.sku === item.sku)
					) {
						strays = [...strays, item];
					}
				}
				stock = {
					item,
					category,
					mode: mode === 'receive' ? 'receive' : mode === 'stocktake' ? 'count' : 'adjust'
				};
				stockOpen = true;
			} else if (result.type === 'location') {
				const { location } = result;
				if (mode === 'lookup') {
					await goto(resolve(`/items?location=${location.id}`));
					return;
				}
				if (mode === 'stocktake') {
					await openBin(location);
					return;
				}
				message = {
					kind: 'info',
					text: `That is the label of bin ${location.code} (${location.name}). Scan an item instead.`
				};
			} else if (mode === 'lookup') {
				await goto(resolve('/projects/[id]', { id: String(result.project.id) }));
				return;
			} else {
				message = {
					kind: 'info',
					text: `That is the label of project “${result.project.name}”. Scan an item instead.`
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
		if (stock.mode === 'count') counted = { ...counted, [item.sku]: result.qtyOnHand };
		const delta = result.movement?.delta ?? result.qtyOnHand - item.qtyOnHand;
		const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
		recent = [
			{
				id: nextId++,
				sku: item.sku,
				name: item.name,
				text:
					(stock.mode === 'count'
						? `counted ${formatQty(result.qtyOnHand, category)} (${delta === 0 ? 'no change' : `${sign}${formatQty(Math.abs(delta), category)}`})`
						: `${sign}${formatQty(Math.abs(delta), category)} → ${formatQty(result.qtyOnHand, category)}`) +
					(result.queued ? ' (queued)' : '')
			},
			...recent
		].slice(0, 10);
	}

	async function pickDone(picked: number) {
		if (!pickLine) return;
		const { line, category } = pickLine;
		recent = [
			{
				id: nextId++,
				sku: line.sku,
				name: line.item.name,
				text: `picked ${formatQty(picked, category)}`
			},
			...recent
		].slice(0, 10);
		await invalidateAll();
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

{#if data.project}
	<div class="mb-3 flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
		<span>Picking parts for <strong>{data.project.name}</strong>: scan each part you take.</span>
		<a class="btn btn-sm ml-auto" href={resolve('/projects/[id]', { id: String(data.project.id) })}>
			Done
		</a>
	</div>
{:else}
	<nav class="mb-3 grid grid-cols-4 gap-1 rounded-lg bg-slate-200 p-1" aria-label="Scan mode">
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
{/if}

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

	{#if mode === 'stocktake' && bin}
		<section class="card" data-testid="stocktake">
			<div class="mb-2 flex items-center gap-2">
				<h2 class="text-sm font-semibold">
					Bin {bin.code} · {countedInBin} of {binItems.length} counted
				</h2>
				<button class="btn btn-sm ml-auto" onclick={() => (bin = null)}>Finish bin</button>
			</div>
			{#if binItems.length === 0}
				<p class="text-sm text-slate-500">No items are recorded in this bin.</p>
			{/if}
			<ul class="divide-y divide-slate-100 text-sm">
				{#each binItems as i (i.sku)}
					{@const cat = data.categories.find((c) => c.id === i.categoryId)}
					<li class="flex items-baseline gap-2 py-1.5" data-sku={i.sku}>
						<span class="w-4 text-green-700">{i.sku in counted ? '✓' : ''}</span>
						<span class="font-mono">{i.sku}</span>
						<span class="truncate text-slate-600">{i.name}</span>
						<span class="ml-auto whitespace-nowrap">
							{#if i.sku in counted}
								{formatQty(counted[i.sku]!, cat)}
							{:else}
								<span class="text-slate-400">expected {formatQty(i.qtyOnHand, cat)}</span>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
			{#if strays.length > 0}
				<h3 class="mt-3 mb-1 text-xs font-semibold text-amber-800 uppercase">
					Found here, recorded elsewhere
				</h3>
				<ul class="divide-y divide-slate-100 text-sm">
					{#each strays as i (i.sku)}
						<li class="flex items-center gap-2 py-1.5">
							<span class="font-mono">{i.sku}</span>
							<span class="truncate text-slate-600">{i.name}</span>
							<button class="btn btn-sm ml-auto" onclick={() => moveHere(i)}>
								Move to {bin.code}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
			{#if binItems.length > countedInBin}
				<p class="mt-2 text-xs text-slate-500">
					Items not scanned are left unchanged. If one is missing, count it as 0 from its page.
				</p>
			{/if}
		</section>
	{/if}

	{#if data.project}
		<section class="card">
			<h2 class="mb-2 text-sm font-semibold">Still to pick</h2>
			{#if toPick.length === 0}
				<p class="text-sm text-slate-500">Everything reserved has been picked.</p>
			{:else}
				<ul class="divide-y divide-slate-100 text-sm" data-testid="to-pick">
					{#each toPick as l (l.id)}
						{@const cat = data.categories.find((c) => c.id === l.item.categoryId)}
						<li class="flex items-baseline gap-2 py-1.5">
							<span class="font-mono">{l.sku}</span>
							<span class="truncate text-slate-600">{l.item.name}</span>
							<span class="ml-auto whitespace-nowrap">{formatQty(l.qtyReserved, cat)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
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

{#if pickLine}
	<ReservationDialog
		bind:open={pickOpen}
		action="pick"
		reservation={pickLine.line}
		category={pickLine.category}
		ondone={pickDone}
	/>
{/if}
