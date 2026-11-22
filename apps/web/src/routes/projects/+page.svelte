<script lang="ts">
	import type { ProjectStatus } from '@inventory/shared';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '#lib/api.js';
	import ErrorAlert from '#lib/components/ErrorAlert.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import { formatDateTime, PROJECT_STATUS_LABELS } from '#lib/format.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const TABS = [
		{ id: 'open', label: 'Open' },
		{ id: 'completed', label: 'Completed' },
		{ id: 'cancelled', label: 'Cancelled' },
		{ id: 'all', label: 'All' }
	] as const;

	let open = $state(false);
	let name = $state('');
	let description = $state('');
	let status = $state<ProjectStatus>('active');
	let error = $state<unknown>(null);

	function startCreate() {
		name = '';
		description = '';
		status = 'active';
		error = null;
		open = true;
	}

	async function create(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		try {
			const project = await api.projects.create({
				name: name.trim(),
				description: description.trim() || null,
				status
			});
			open = false;
			await goto(resolve('/projects/[id]', { id: String(project.id) }));
		} catch (err) {
			error = err;
		}
	}
</script>

<div class="mb-4 flex items-center justify-between gap-2">
	<h1 class="text-2xl font-bold">Projects</h1>
	<button class="btn btn-primary" onclick={startCreate}>+ New project</button>
</div>

<nav class="mb-4 flex gap-1" aria-label="Project filter">
	{#each TABS as tab (tab.id)}
		<a
			href={resolve(`/projects?show=${tab.id}`)}
			data-sveltekit-replacestate
			class="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-slate-100"
			class:bg-slate-200={data.filter === tab.id}
			aria-current={data.filter === tab.id ? 'page' : undefined}
		>
			{tab.label}
		</a>
	{/each}
</nav>

{#if data.projects.length === 0}
	<p class="card text-center text-slate-500">No projects here yet.</p>
{:else}
	<ul class="card divide-y divide-slate-100 p-0">
		{#each data.projects as p (p.id)}
			<li>
				<a
					href={resolve('/projects/[id]', { id: String(p.id) })}
					class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-slate-50"
				>
					<span class="font-medium">{p.name}</span>
					<span class="badge">{PROJECT_STATUS_LABELS[p.status]}</span>
					<span class="ml-auto flex gap-3 text-sm text-slate-600">
						{#if p.openLines > 0}<span>{p.openLines} reserved</span>{/if}
						{#if p.shortLines > 0}
							<span class="font-medium text-red-700">{p.shortLines} short</span>
						{/if}
						{#if p.consumedLines > 0}<span>{p.consumedLines} used</span>{/if}
						<span class="hidden text-slate-400 sm:inline">{formatDateTime(p.updatedAt)}</span>
					</span>
				</a>
			</li>
		{/each}
	</ul>
{/if}

<Modal bind:open title="New project">
	<form id="project-form" onsubmit={create} class="space-y-3">
		<div>
			<label class="label" for="project-name">Name</label>
			<input id="project-name" class="input" bind:value={name} required maxlength="200" />
		</div>
		<div>
			<label class="label" for="project-description">Description</label>
			<textarea id="project-description" class="input" rows="3" bind:value={description}></textarea>
		</div>
		<div>
			<label class="label" for="project-status">Status</label>
			<select id="project-status" class="input" bind:value={status}>
				<option value="planning">Planning</option>
				<option value="active">Active</option>
			</select>
		</div>
		<ErrorAlert {error} />
	</form>
	{#snippet actions()}
		<button class="btn" onclick={() => (open = false)}>Cancel</button>
		<button class="btn btn-primary" type="submit" form="project-form">Create project</button>
	{/snippet}
</Modal>
