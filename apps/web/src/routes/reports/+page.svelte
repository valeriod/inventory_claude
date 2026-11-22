<script lang="ts">
	import type { ReportCell, ReportColumn } from '@inventory/shared';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { api } from '#lib/api.js';
	import TreeSelect from '#lib/components/TreeSelect.svelte';
	import { formatDateTime, REASON_LABELS } from '#lib/format.js';
	import { toApiQuery } from '#lib/report-query.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const TABS = [
		{ id: 'inventory', label: 'Inventory' },
		{ id: 'low-stock', label: 'Low stock' },
		{ id: 'project', label: 'Project' },
		{ id: 'movements', label: 'Movements' }
	] as const;

	const params = $derived(page.url.searchParams);
	const numParam = (name: string) => (params.get(name) ? Number(params.get(name)) : null);
	const numbers = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 });

	function setParam(name: string, value: string | number | null | undefined | boolean) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- temporary copy used to build a URL
		const next = new URLSearchParams(page.url.searchParams.toString());
		if (value === null || value === undefined || value === '' || value === false) next.delete(name);
		else next.set(name, String(value));
		next.set('report', data.kind);
		goto(resolve(`/reports?${next}`), { replace: true, reset: false });
	}

	function cell(value: ReportCell | undefined, column: ReportColumn): string {
		if (value === null || value === undefined || value === '') return '';
		if (column.type === 'number' && typeof value === 'number') return numbers.format(value);
		if (column.type === 'datetime' && typeof value === 'string') return formatDateTime(value);
		return String(value);
	}

	const downloadUrl = (format: 'csv' | 'pdf') =>
		api.reports.url(data.kind, toApiQuery(page.url.searchParams), format);
</script>

<svelte:head><title>Reports · Inventory</title></svelte:head>

<div class="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
	<h1 class="text-2xl font-bold">Reports</h1>
	{#if data.report}
		<div class="flex flex-wrap gap-2">
			<!-- eslint-disable svelte/no-navigation-without-resolve -- API downloads, not app routes -->
			<a class="btn" href={downloadUrl('csv')} download>Download CSV</a>
			<a class="btn" href={downloadUrl('pdf')} target="_blank" rel="noopener">Open PDF</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
			<button class="btn" onclick={() => window.print()}>Print</button>
		</div>
	{/if}
</div>

<nav class="mb-4 flex flex-wrap gap-1 print:hidden" aria-label="Report">
	{#each TABS as tab (tab.id)}
		<a
			href={resolve(`/reports?report=${tab.id}`)}
			data-sveltekit-replacestate
			class="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-slate-100"
			class:bg-slate-200={data.kind === tab.id}
			aria-current={data.kind === tab.id ? 'page' : undefined}
		>
			{tab.label}
		</a>
	{/each}
</nav>

<section
	class="card mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 print:hidden"
	aria-label="Filters"
>
	{#if data.kind === 'inventory' || data.kind === 'low-stock'}
		<div>
			<label class="label" for="r-category">Category</label>
			<TreeSelect
				id="r-category"
				nodes={data.categories}
				value={numParam('category')}
				placeholder="All categories"
				onchange={(v) => setParam('category', v)}
			/>
		</div>
		<div>
			<label class="label" for="r-location">Location</label>
			<TreeSelect
				id="r-location"
				nodes={data.locations}
				value={numParam('location')}
				placeholder="All locations"
				onchange={(v) => setParam('location', v)}
			/>
		</div>
		{#if data.kind === 'inventory'}
			<label class="flex items-center gap-2 self-end pb-2 text-sm">
				<input
					type="checkbox"
					checked={params.get('includeArchived') === 'true'}
					onchange={(e) => setParam('includeArchived', e.currentTarget.checked)}
				/>
				Include archived items
			</label>
		{/if}
	{:else if data.kind === 'project'}
		<div class="sm:col-span-2">
			<label class="label" for="r-project">Project</label>
			<select
				id="r-project"
				class="input"
				value={params.get('project') ?? ''}
				onchange={(e) => setParam('project', e.currentTarget.value)}
			>
				<option value="">Choose a project…</option>
				{#each data.projects as p (p.id)}
					<option value={String(p.id)}>{p.name}</option>
				{/each}
			</select>
		</div>
	{:else}
		<div>
			<label class="label" for="r-from">From</label>
			<input
				id="r-from"
				class="input"
				type="date"
				value={params.get('fromDate') ?? ''}
				onchange={(e) => setParam('fromDate', e.currentTarget.value)}
			/>
		</div>
		<div>
			<label class="label" for="r-to">To (inclusive)</label>
			<input
				id="r-to"
				class="input"
				type="date"
				value={params.get('toDate') ?? ''}
				onchange={(e) => setParam('toDate', e.currentTarget.value)}
			/>
		</div>
		<div>
			<label class="label" for="r-reason">Reason</label>
			<select
				id="r-reason"
				class="input"
				value={params.get('reason') ?? ''}
				onchange={(e) => setParam('reason', e.currentTarget.value)}
			>
				<option value="">All</option>
				{#each Object.entries(REASON_LABELS) as [value, label] (value)}
					<option {value}>{label}</option>
				{/each}
			</select>
		</div>
		<div>
			<label class="label" for="r-sku">SKU</label>
			<input
				id="r-sku"
				class="input font-mono"
				value={params.get('sku') ?? ''}
				onchange={(e) => setParam('sku', e.currentTarget.value.trim())}
			/>
		</div>
		<div>
			<label class="label" for="r-mproject">Project</label>
			<select
				id="r-mproject"
				class="input"
				value={params.get('project') ?? ''}
				onchange={(e) => setParam('project', e.currentTarget.value)}
			>
				<option value="">All</option>
				{#each data.projects as p (p.id)}
					<option value={String(p.id)}>{p.name}</option>
				{/each}
			</select>
		</div>
	{/if}
</section>

{#if data.reportError}
	<div role="alert" class="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
		{data.reportError}
	</div>
{:else if !data.report}
	<p class="card text-center text-slate-500">Choose a project to see its parts and what to buy.</p>
{:else}
	{@const report = data.report}
	<section aria-labelledby="report-title">
		<h2 id="report-title" class="text-xl font-semibold">{report.title}</h2>
		<p class="text-sm text-slate-600">
			{[...report.filters, `Generated ${formatDateTime(report.generatedAt)}`].join(' · ')}
		</p>
		{#if report.summary.length > 0}
			<p class="mt-1 flex flex-wrap gap-4 text-sm" data-testid="report-summary">
				{#each report.summary as s (s.label)}
					<span>{s.label}: <strong>{s.value}</strong></span>
				{/each}
			</p>
		{/if}
		{#if report.truncated}
			<p class="mt-1 text-sm text-amber-700">
				Only the first {report.rows.length} rows are shown; narrow the filters.
			</p>
		{/if}

		{#if report.rows.length === 0}
			<p class="card mt-3 text-center text-slate-500">No rows.</p>
		{:else}
			<div
				class="card mt-3 overflow-x-auto p-0 print:overflow-visible print:border-0 print:shadow-none"
			>
				<table class="w-full text-left text-sm print:text-xs" data-testid="report-table">
					<thead class="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 uppercase">
						<tr>
							{#each report.columns as c (c.key)}
								<th class="px-3 py-2 whitespace-nowrap" class:text-right={c.type === 'number'}>
									{c.label}
								</th>
							{/each}
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each report.rows as row, i (i)}
							<tr class="break-inside-avoid">
								{#each report.columns as c (c.key)}
									<td
										class="px-3 py-1.5"
										class:text-right={c.type === 'number'}
										class:whitespace-nowrap={c.type !== 'text'}
										class:font-mono={c.key === 'sku'}
									>
										{cell(row[c.key], c)}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
{/if}
