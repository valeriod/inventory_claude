<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { api } from '#lib/api.js';
	import ErrorAlert from '#lib/components/ErrorAlert.svelte';

	let password = $state('');
	let error = $state<unknown>(null);
	let busy = $state(false);

	/** Only same-origin paths are allowed as redirect targets. */
	function nextPath(): string {
		const next = page.url.searchParams.get('next') ?? '/';
		return next.startsWith('/') && !next.startsWith('//') ? next : '/';
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		busy = true;
		try {
			await api.login(password);
			await invalidateAll();
			await goto(resolve(nextPath() as '/'), { replace: true });
		} catch (err) {
			error = err;
		} finally {
			busy = false;
		}
	}
</script>

<div class="mx-auto mt-16 max-w-sm">
	<h1 class="mb-6 text-center text-2xl font-bold">Inventory</h1>
	<form class="card space-y-4" onsubmit={submit}>
		<div>
			<label class="label" for="password">Password</label>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				id="password"
				class="input"
				type="password"
				autocomplete="current-password"
				bind:value={password}
				autofocus
				required
			/>
		</div>
		<ErrorAlert {error} />
		<button class="btn btn-primary w-full" disabled={busy || !password}>Log in</button>
	</form>
</div>
