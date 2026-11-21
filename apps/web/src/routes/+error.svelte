<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
</script>

<div class="card mx-auto max-w-lg text-center">
	<p class="text-4xl font-bold text-slate-300">{page.status}</p>
	<p class="mt-2">{page.error?.message ?? 'Something went wrong'}</p>
	<a class="btn mt-4" href={resolve('/')}>Back to home</a>
</div>
