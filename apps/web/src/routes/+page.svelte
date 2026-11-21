<script lang="ts">
	import { fetchHealth } from '#lib/api.js';

	const health = fetchHealth();
</script>

<h1 class="text-2xl font-bold">Inventory</h1>
<p class="mt-2 text-slate-600">Project scaffold (M0). Features arrive in later milestones.</p>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-4">
	<h2 class="font-semibold">API status</h2>
	{#await health}
		<p class="mt-1 text-slate-500">Checking…</p>
	{:then h}
		<p class="mt-1 text-green-700">
			Connected: version {h.version}, database {h.database}
		</p>
	{:catch err}
		<p class="mt-1 text-red-700">Unavailable: {err.message}</p>
	{/await}
</section>
