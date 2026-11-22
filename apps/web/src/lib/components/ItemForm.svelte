<script lang="ts">
	import type {
		CategoryWithFields,
		CreateItemRequest,
		ItemWithAvailability,
		Location
	} from '@inventory/shared';
	import { fromFormValues, toFormValues, type FormValues } from '#lib/attribute-form.js';
	import AttributesForm from './AttributesForm.svelte';
	import ErrorAlert from './ErrorAlert.svelte';
	import QuantityInput from './QuantityInput.svelte';
	import TreeSelect from './TreeSelect.svelte';

	export type ItemPayload = Omit<CreateItemRequest, 'categoryId'> & { categoryId: number };

	let {
		item,
		categories,
		locations,
		initialCategoryId,
		initialBarcode,
		onsave
	}: {
		item?: ItemWithAvailability;
		categories: CategoryWithFields[];
		locations: Location[];
		initialCategoryId?: number;
		/** Pre-filled barcode, e.g. after scanning an unknown code. */
		initialBarcode?: string;
		onsave: (payload: ItemPayload) => Promise<void>;
	} = $props();

	// Form state is initialised once; the parent re-keys this component to reset it.
	// svelte-ignore state_referenced_locally
	const initial = item;
	// svelte-ignore state_referenced_locally
	let categoryId = $state<number | null>(initial?.categoryId ?? initialCategoryId ?? null);
	let name = $state(initial?.name ?? '');
	let description = $state(initial?.description ?? '');
	let sku = $state('');
	// svelte-ignore state_referenced_locally
	let barcode = $state(initial?.barcode ?? initialBarcode ?? '');
	let locationId = $state<number | null>(initial?.locationId ?? null);
	let qtyMin = $state<number | null>(initial?.qtyMin ?? null);
	let qtyMinValid = $state(true);
	let qtyInitial = $state<number | null>(null);
	let qtyInitialValid = $state(true);
	// svelte-ignore state_referenced_locally
	let values = $state<FormValues>(
		initial
			? toFormValues(
					categories.find((c) => c.id === initial.categoryId)?.resolvedFieldDefs ?? [],
					initial.attributes
				)
			: {}
	);

	let errors = $state<Record<string, string>>({});
	let attrErrors = $state<Record<string, string>>({});
	let error = $state<unknown>(null);
	let busy = $state(false);

	const category = $derived(categories.find((c) => c.id === categoryId));
	const defs = $derived(category?.resolvedFieldDefs ?? []);
	const unitChanged = $derived(
		initial !== undefined &&
			category !== undefined &&
			categories.find((c) => c.id === initial.categoryId)?.unitKind !== category.unitKind
	);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		const local: Record<string, string> = {};
		if (!category) local.categoryId = 'Choose a category';
		if (!name.trim()) local.name = 'Enter a name';
		if (!qtyMinValid) local.qtyMin = 'Invalid quantity';
		if (!qtyInitialValid) local.qtyOnHand = 'Invalid quantity';
		const attrs = fromFormValues(defs, values, Object.keys(initial?.attributes ?? {}));
		errors = local;
		attrErrors = attrs.errors;
		if (Object.keys(local).length || Object.keys(attrs.errors).length) {
			error = new Error('Please fix the highlighted fields');
			return;
		}

		busy = true;
		try {
			await onsave({
				categoryId: category!.id,
				name: name.trim(),
				description: description.trim() || null,
				barcode: barcode.trim() || null,
				locationId,
				qtyMin,
				attributes: attrs.attributes,
				...(!initial && sku.trim() && { sku: sku.trim() }),
				...(!initial && qtyInitial !== null && { qtyOnHand: qtyInitial })
			});
		} catch (err) {
			error = err;
			const fe = (err as { fieldErrors?: Record<string, string> }).fieldErrors ?? {};
			errors = Object.fromEntries(Object.entries(fe).filter(([k]) => !k.startsWith('attributes.')));
			attrErrors = Object.fromEntries(
				Object.entries(fe)
					.filter(([k]) => k.startsWith('attributes.'))
					.map(([k, v]) => [k.slice('attributes.'.length), v])
			);
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={submit} class="space-y-6" novalidate>
	<section class="card grid gap-4 sm:grid-cols-2">
		<div>
			<label class="label" for="item-category">Category</label>
			<TreeSelect
				id="item-category"
				nodes={categories}
				bind:value={categoryId}
				placeholder="Choose…"
			/>
			{#if errors.categoryId}<p class="field-error">{errors.categoryId}</p>{/if}
			{#if unitChanged}<p class="field-error">
					The new category measures stock differently; this is not allowed.
				</p>{/if}
		</div>
		<div>
			<label class="label" for="item-name">Name</label>
			<input id="item-name" class="input" bind:value={name} aria-invalid={!!errors.name} />
			{#if errors.name}<p class="field-error">{errors.name}</p>{/if}
		</div>
		{#if !initial}
			<div>
				<label class="label" for="item-sku">SKU</label>
				<input
					id="item-sku"
					class="input font-mono"
					bind:value={sku}
					placeholder={category?.skuPrefix
						? `Automatic (${category.skuPrefix}…)`
						: 'Required: category has no prefix'}
				/>
				{#if errors.sku}<p class="field-error">{errors.sku}</p>{/if}
			</div>
		{/if}
		<div>
			<label class="label" for="item-barcode">Manufacturer barcode</label>
			<input id="item-barcode" class="input font-mono" bind:value={barcode} />
			{#if errors.barcode}<p class="field-error">{errors.barcode}</p>{/if}
		</div>
		<div>
			<label class="label" for="item-location">Location</label>
			<TreeSelect
				id="item-location"
				nodes={locations}
				bind:value={locationId}
				placeholder="— none —"
			/>
		</div>
		<div class="sm:col-span-2">
			<label class="label" for="item-description">Description</label>
			<textarea id="item-description" class="input" rows="2" bind:value={description}></textarea>
		</div>
		{#if category}
			{#key category.id}
				{#if !initial}
					<div>
						<label class="label" for="item-qty">Initial stock</label>
						<QuantityInput
							id="item-qty"
							kind={category.unitKind}
							unit={category.displayUnit}
							bind:value={qtyInitial}
							bind:valid={qtyInitialValid}
						/>
						{#if errors.qtyOnHand}<p class="field-error">{errors.qtyOnHand}</p>{/if}
					</div>
				{/if}
				<div>
					<label class="label" for="item-min">Reorder below</label>
					<QuantityInput
						id="item-min"
						kind={category.unitKind}
						unit={category.displayUnit}
						bind:value={qtyMin}
						bind:valid={qtyMinValid}
					/>
				</div>
			{/key}
		{/if}
	</section>

	{#if category}
		<section class="card">
			<h2 class="mb-3 font-semibold">{category.name} details</h2>
			<AttributesForm {defs} bind:values errors={attrErrors} />
		</section>
	{/if}

	<ErrorAlert {error} />
	<div class="flex justify-end">
		<button type="submit" class="btn btn-primary" disabled={busy}>
			{initial ? 'Save changes' : 'Create item'}
		</button>
	</div>
</form>
