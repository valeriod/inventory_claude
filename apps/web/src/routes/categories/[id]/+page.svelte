<script lang="ts">
	import { FIELD_KEY_PATTERN, type CreateCategoryRequest } from '@inventory/shared';
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { api } from '#lib/api.js';
	import CategoryForm from '#lib/components/CategoryForm.svelte';
	import ErrorAlert from '#lib/components/ErrorAlert.svelte';
	import Modal from '#lib/components/Modal.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let saved = $state(false);
	let renameKey = $state<string | null>(null);
	let newKey = $state('');
	let renameError = $state<unknown>(null);
	let confirmDelete = $state(false);
	let deleteError = $state<unknown>(null);

	async function save(payload: Required<CreateCategoryRequest>) {
		saved = false;
		await api.categories.update(data.category.id, payload);
		await invalidateAll();
		saved = true;
	}

	function startRename(key: string) {
		renameKey = key;
		newKey = key;
		renameError = null;
	}

	async function rename(e: SubmitEvent) {
		e.preventDefault();
		if (!renameKey) return;
		if (!FIELD_KEY_PATTERN.test(newKey)) {
			renameError = new Error('Use lower-case letters, digits and _, starting with a letter');
			return;
		}
		try {
			await api.categories.renameField(data.category.id, renameKey, newKey);
			renameKey = null;
			await invalidateAll();
		} catch (err) {
			renameError = err;
		}
	}

	async function remove() {
		deleteError = null;
		try {
			await api.categories.remove(data.category.id);
			confirmDelete = false;
			await goto(resolve('/categories'));
		} catch (err) {
			deleteError = err;
		}
	}
</script>

<div class="mb-4 flex flex-wrap items-center justify-between gap-2">
	<h1 class="text-2xl font-bold">{data.category.name}</h1>
	<div class="flex gap-2">
		<a class="btn" href={resolve(`/items?category=${data.category.id}`)}>View items</a>
		<button class="btn btn-danger" onclick={() => (confirmDelete = true)}>Delete…</button>
	</div>
</div>

{#if saved}
	<div
		role="status"
		class="mb-4 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800"
	>
		Saved.
	</div>
{/if}

{#key data.category.updatedAt}
	<CategoryForm
		category={data.category}
		categories={data.categories}
		onsave={save}
		onrename={startRename}
	/>
{/key}

<Modal open={renameKey !== null} title="Rename field">
	<form id="rename-form" onsubmit={rename} class="space-y-3">
		<p class="text-sm">
			Renames <code>{renameKey}</code> and moves its stored values on every item in this category and
			its sub-categories. Unsaved changes on this page are discarded.
		</p>
		<div>
			<label class="label" for="new-key">New key</label>
			<input id="new-key" class="input font-mono" bind:value={newKey} />
		</div>
		<ErrorAlert error={renameError} />
	</form>
	{#snippet actions()}
		<button class="btn" onclick={() => (renameKey = null)}>Cancel</button>
		<button class="btn btn-primary" type="submit" form="rename-form">Rename</button>
	{/snippet}
</Modal>

<Modal bind:open={confirmDelete} title="Delete category?">
	<p class="text-sm">Only categories without items and sub-categories can be deleted.</p>
	<ErrorAlert error={deleteError} />
	{#snippet actions()}
		<button class="btn" onclick={() => (confirmDelete = false)}>Cancel</button>
		<button class="btn btn-danger" onclick={remove}>Delete</button>
	{/snippet}
</Modal>
