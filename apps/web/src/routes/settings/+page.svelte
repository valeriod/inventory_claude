<script lang="ts">
	import { resolve } from '$app/paths';
	import { api } from '#lib/api.js';
	import { formatDateTime } from '#lib/format.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const system = $derived(data.system);
</script>

<svelte:head><title>Settings · Inventory</title></svelte:head>

<h1 class="mb-4 text-2xl font-bold">Settings</h1>

<div class="grid gap-4 md:grid-cols-2">
	<section class="card space-y-3 text-sm" aria-labelledby="data-heading">
		<h2 id="data-heading" class="font-semibold">Your data</h2>
		<p>
			A full export holds everything (categories, items, locations, projects and stock history). It
			can be restored into a new installation with <code>db:transfer</code>.
		</p>
		<div class="flex flex-wrap gap-2">
			<!-- eslint-disable svelte/no-navigation-without-resolve -- API downloads -->
			<a class="btn btn-sm" href={api.exportUrl('json')} download>Export everything (JSON)</a>
			<a class="btn btn-sm" href={api.exportUrl('csv')} download>Export items (CSV)</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
			<a class="btn btn-sm" href={resolve('/import')}>Import items (CSV)</a>
		</div>
	</section>

	<section class="card space-y-2 text-sm" aria-labelledby="backup-heading">
		<h2 id="backup-heading" class="font-semibold">Backups</h2>
		{#if system.backup}
			<p>
				Every night at {system.backup.hour}:00 to <code>{system.backup.dir}</code>, keeping the last
				{system.backup.keep}.
			</p>
			<p data-testid="last-backup">
				{#if system.backup.lastBackup}
					Last backup: {system.backup.lastBackup.file} ({formatDateTime(
						system.backup.lastBackup.at
					)})
				{:else}
					No backup yet.
				{/if}
			</p>
		{:else}
			<p>
				Automatic backups are off. Set <code>BACKUP_DIR</code> on the server (the Docker image uses
				<code>/data/backups</code>), or download an export above.
			</p>
		{/if}
	</section>

	<section class="card space-y-2 text-sm" aria-labelledby="labels-heading">
		<h2 id="labels-heading" class="font-semibold">QR labels</h2>
		<p>
			Labels link to <code>{data.labels.baseUrl}</code>.
			{#if !data.labels.configured}
				<span class="text-amber-800">
					Set <code>PUBLIC_URL</code> to the address you use on your phone before printing labels you
					keep.
				</span>
			{/if}
		</p>
	</section>

	<section class="card space-y-2 text-sm" aria-labelledby="about-heading">
		<h2 id="about-heading" class="font-semibold">About</h2>
		<p>Version {system.version} · {system.database === 'sqlite' ? 'SQLite' : 'PostgreSQL'}</p>
		<p><a class="link" href={resolve('/sync')}>Offline & sync</a></p>
	</section>
</div>
