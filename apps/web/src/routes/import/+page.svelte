<script lang="ts">
	import type { ImportResult } from '@inventory/shared';
	import { resolve } from '$app/paths';
	import { api } from '#lib/api.js';
	import ErrorAlert from '#lib/components/ErrorAlert.svelte';
	import TreeSelect from '#lib/components/TreeSelect.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let category = $state<number | null>(null);
	let csv = $state('');
	let fileName = $state('');
	let updateStock = $state(false);
	let result = $state<ImportResult | null>(null);
	let error = $state<unknown>(null);
	let busy = $state(false);

	const ACTION_LABELS = {
		create: 'New',
		update: 'Update',
		unchanged: 'No change',
		error: 'Error'
	} as const;
	const ACTION_CLASSES = {
		create: 'bg-green-100 text-green-800',
		update: 'bg-blue-100 text-blue-800',
		unchanged: 'bg-slate-100 text-slate-600',
		error: 'bg-red-100 text-red-800'
	} as const;

	async function pickFile(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		fileName = file.name;
		csv = await file.text();
		result = null;
	}

	async function run(commit: boolean) {
		error = null;
		busy = true;
		try {
			result = await api.importItems(csv, { category, updateStock, commit });
		} catch (err) {
			error = err;
		} finally {
			busy = false;
		}
	}

	const changes = $derived(result ? result.summary.create + result.summary.update : 0);
</script>

<svelte:head><title>Import items · Inventory</title></svelte:head>

<h1 class="mb-1 text-2xl font-bold">Import items from CSV</h1>
<p class="mb-4 text-sm text-slate-600">
	One row per item. Rows with a known SKU update that item; other rows create items. Columns: SKU,
	Name, Description, Category, Location (code), Barcode, On hand, Unit, Min, and the category's
	fields by name. An <a class="link" href={resolve('/settings')}>items export</a> has exactly these columns.
</p>

<section class="card mb-4 grid gap-4 md:grid-cols-2">
	<div>
		<label class="label" for="import-file">CSV file</label>
		<input id="import-file" type="file" accept=".csv,text/csv" class="input" onchange={pickFile} />
		{#if fileName}<p class="mt-1 text-xs text-slate-500">{fileName}</p>{/if}
	</div>
	<div>
		<label class="label" for="import-category">Category for rows without one</label>
		<TreeSelect
			id="import-category"
			nodes={data.categories}
			bind:value={category}
			placeholder="—"
		/>
		{#if category}
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- API download -->
			<a class="link mt-1 inline-block text-xs" href={api.importTemplateUrl(category)} download>
				Download an empty template for this category
			</a>
		{/if}
	</div>
	<div class="md:col-span-2">
		<label class="label" for="import-text">…or paste CSV</label>
		<textarea
			id="import-text"
			class="input font-mono text-xs"
			rows="5"
			bind:value={csv}
			oninput={() => (result = null)}></textarea>
	</div>
	<label class="flex items-start gap-2 text-sm md:col-span-2">
		<input
			type="checkbox"
			class="mt-1"
			bind:checked={updateStock}
			onchange={() => (result = null)}
		/>
		<span>
			Set the stock of existing items to the file's "On hand" (records a count for each change).
			Leave off to update only names, locations and fields.
		</span>
	</label>
	<div class="flex gap-2 md:col-span-2">
		<button class="btn" disabled={!csv.trim() || busy} onclick={() => run(false)}>
			Check file
		</button>
		{#if result && !result.committed && result.summary.error === 0 && changes > 0}
			<button class="btn btn-primary" disabled={busy} onclick={() => run(true)}>
				Import {changes} item{changes === 1 ? '' : 's'}
			</button>
		{/if}
	</div>
	<div class="md:col-span-2"><ErrorAlert {error} /></div>
</section>

{#if result}
	<section class="card p-0" aria-labelledby="result-heading">
		<div class="space-y-1 px-4 pt-4 pb-2 text-sm">
			<h2 id="result-heading" class="font-semibold" data-testid="import-summary">
				{#if result.committed}
					Imported: {result.summary.create} new, {result.summary.update} updated.
				{:else}
					{result.summary.create} new · {result.summary.update} to update ·
					{result.summary.unchanged} unchanged · {result.summary.error} with errors
				{/if}
			</h2>
			{#if !result.committed && result.summary.error > 0}
				<p class="text-red-700">
					Fix the rows with errors and check again; nothing has been changed.
				</p>
			{/if}
			{#if result.unknownColumns.length > 0}
				<p class="text-amber-800">
					Ignored columns (no matching field): {result.unknownColumns.join(', ')}
				</p>
			{/if}
		</div>
		<div class="overflow-x-auto">
			<table class="w-full text-left text-sm" data-testid="import-rows">
				<thead class="border-y border-slate-200 bg-slate-50 text-xs text-slate-500 uppercase">
					<tr>
						<th class="px-4 py-2">Line</th>
						<th class="px-3 py-2">SKU</th>
						<th class="px-3 py-2">Name</th>
						<th class="px-3 py-2">Result</th>
						<th class="px-3 py-2">Details</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each result.rows as row (row.line)}
						<tr>
							<td class="px-4 py-1.5 text-slate-500">{row.line}</td>
							<td class="px-3 py-1.5 font-mono">
								{#if row.sku && result.committed && row.action !== 'error'}
									<a class="link" href={resolve('/items/[sku]', { sku: row.sku })}>{row.sku}</a>
								{:else}{row.sku ?? '—'}{/if}
							</td>
							<td class="px-3 py-1.5">{row.name}</td>
							<td class="px-3 py-1.5">
								<span
									class="rounded px-1.5 py-0.5 text-xs font-medium {ACTION_CLASSES[row.action]}"
								>
									{ACTION_LABELS[row.action]}
								</span>
							</td>
							<td class="px-3 py-1.5 text-xs">
								{#each row.errors as e (e)}<div class="text-red-700">{e}</div>{/each}
								{#each row.warnings as w (w)}<div class="text-amber-800">{w}</div>{/each}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{/if}
