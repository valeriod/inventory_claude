import type { FieldDefInput } from '@inventory/shared';
import { describe, expect, it } from 'vitest';
import {
	ConflictError,
	FieldChangeConflictError,
	InvalidOperationError,
	NotFoundError
} from './errors.ts';
import { createCountCategory, useTestDatabase } from './test-helpers.ts';

describe('CategoryRepository', () => {
	const fx = useTestDatabase();

	it('creates and reads a category with field definitions', async () => {
		const { repos } = fx();
		const created = await createCountCategory(repos);
		const read = await repos.categories.get(created.id);
		expect(read).toEqual(created);
		expect(read.fieldDefs.map((f) => f.key)).toEqual(['resistance', 'package', 'tags', 'rohs']);
		expect(read.fieldDefs[0]).toMatchObject({ required: false, searchable: true });
		expect(read.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
	});

	it('rejects invalid field definitions', async () => {
		await expect(
			fx().repos.categories.create({
				name: 'Bad',
				unitKind: 'count',
				displayUnit: 'pcs',
				fieldDefs: [{ key: 'Bad Key', label: 'x', type: 'text' }]
			})
		).rejects.toThrow();
	});

	it('rejects duplicate names and SKU prefixes', async () => {
		const { repos } = fx();
		await createCountCategory(repos, 'Resistors', 'RES-');
		await expect(createCountCategory(repos, 'Resistors', 'R2-')).rejects.toBeInstanceOf(
			ConflictError
		);
		await expect(createCountCategory(repos, 'Other', 'RES-')).rejects.toBeInstanceOf(ConflictError);
	});

	it('generates sequential SKUs, skipping ones already taken', async () => {
		const { repos } = fx();
		const cat = await createCountCategory(repos);
		await repos.items.create({ sku: 'RES-0002', categoryId: cat.id, name: 'manual' });
		expect(await repos.categories.nextSku(cat.id)).toBe('RES-0001');
		expect(await repos.categories.nextSku(cat.id)).toBe('RES-0003');
	});

	it('requires a prefix to generate SKUs', async () => {
		const { repos } = fx();
		const cat = await repos.categories.create({
			name: 'Misc',
			unitKind: 'count',
			displayUnit: 'pcs'
		});
		await expect(repos.categories.nextSku(cat.id)).rejects.toBeInstanceOf(InvalidOperationError);
	});

	it('prevents parent cycles', async () => {
		const { repos } = fx();
		const a = await repos.categories.create({ name: 'A', unitKind: 'count', displayUnit: 'pcs' });
		const b = await repos.categories.create({
			name: 'B',
			parentId: a.id,
			unitKind: 'count',
			displayUnit: 'pcs'
		});
		await expect(repos.categories.update(a.id, { parentId: b.id })).rejects.toBeInstanceOf(
			InvalidOperationError
		);
		await expect(repos.categories.update(a.id, { parentId: a.id })).rejects.toBeInstanceOf(
			InvalidOperationError
		);
	});

	it('blocks unit kind changes once the category has items', async () => {
		const { repos } = fx();
		const cat = await createCountCategory(repos);
		const changed = await repos.categories.update(cat.id, { unitKind: 'length', displayUnit: 'm' });
		expect(changed).toMatchObject({ unitKind: 'length', displayUnit: 'm' });
		await repos.categories.update(cat.id, { unitKind: 'count', displayUnit: 'pcs' });
		await repos.items.create({ categoryId: cat.id, name: 'x' });
		await expect(
			repos.categories.update(cat.id, { unitKind: 'mass', displayUnit: 'kg' })
		).rejects.toBeInstanceOf(ConflictError);
	});

	it('validates the display unit against the unit kind', async () => {
		const { repos } = fx();
		await expect(
			repos.categories.create({ name: 'Wire', unitKind: 'length', displayUnit: 'kg' })
		).rejects.toThrow(/not a length unit/);
		const wire = await repos.categories.create({
			name: 'Wire',
			unitKind: 'length',
			displayUnit: 'm'
		});
		await repos.items.create({ sku: 'W-1', categoryId: wire.id, name: 'x', qtyOnHand: 1000 });
		// display unit may change freely; stored base units are unaffected
		expect((await repos.categories.update(wire.id, { displayUnit: 'ft' })).displayUnit).toBe('ft');
		expect((await repos.items.get('W-1')).qtyOnHand).toBe(1000);
		await expect(repos.categories.update(wire.id, { displayUnit: 'pcs' })).rejects.toBeInstanceOf(
			InvalidOperationError
		);
	});

	it('refuses to delete a category that is in use', async () => {
		const { repos } = fx();
		const cat = await createCountCategory(repos);
		await repos.items.create({ categoryId: cat.id, name: 'x' });
		await expect(repos.categories.delete(cat.id)).rejects.toBeInstanceOf(ConflictError);
		await expect(repos.categories.delete(9999)).rejects.toBeInstanceOf(NotFoundError);
	});

	describe('field inheritance', () => {
		async function tree() {
			const { repos } = fx();
			const electronics = await repos.categories.create({
				name: 'Electronics',
				unitKind: 'count',
				displayUnit: 'pcs',
				fieldDefs: [{ key: 'manufacturer', label: 'Manufacturer', type: 'text' }]
			});
			const resistors = await repos.categories.create({
				name: 'Resistors',
				parentId: electronics.id,
				skuPrefix: 'RES-',
				unitKind: 'count',
				displayUnit: 'pcs',
				fieldDefs: [
					{ key: 'resistance', label: 'Resistance', type: 'quantity', unit: 'Ω' },
					{ key: 'tolerance', label: 'Tolerance', type: 'enum', options: ['1%', '5%'] }
				]
			});
			const tools = await repos.categories.create({
				name: 'Tools',
				unitKind: 'count',
				displayUnit: 'pcs'
			});
			return { repos, electronics, resistors, tools };
		}

		it('resolves inherited fields', async () => {
			const { repos, resistors } = await tree();
			const resolved = await repos.categories.resolvedFieldDefs(resistors.id);
			expect(resolved.map((d) => d.key)).toEqual(['manufacturer', 'resistance', 'tolerance']);
			const listed = await repos.categories.listWithFields();
			expect(listed.find((c) => c.id === resistors.id)?.resolvedFieldDefs).toHaveLength(3);
		});

		it('rejects a child field that shadows an inherited one', async () => {
			const { repos, electronics, resistors } = await tree();
			await expect(
				repos.categories.create({
					name: 'ICs',
					parentId: electronics.id,
					unitKind: 'count',
					displayUnit: 'pcs',
					fieldDefs: [{ key: 'manufacturer', label: 'Maker', type: 'text' }]
				})
			).rejects.toThrow(/declared by both "Electronics" and its descendant/);
			// … also when a parent adds a key a descendant already has
			await expect(
				repos.categories.update(electronics.id, {
					fieldDefs: [
						{ key: 'manufacturer', label: 'Manufacturer', type: 'text' },
						{ key: 'tolerance', label: 'Tolerance', type: 'text' }
					]
				})
			).rejects.toBeInstanceOf(ConflictError);
			expect((await repos.categories.get(resistors.id)).fieldDefs).toHaveLength(2);
		});

		it('rejects re-parenting that would create a key conflict', async () => {
			const { repos, resistors, tools } = await tree();
			await repos.categories.update(tools.id, {
				fieldDefs: [{ key: 'resistance', label: 'R', type: 'number' }]
			});
			await expect(
				repos.categories.update(resistors.id, { parentId: tools.id })
			).rejects.toBeInstanceOf(ConflictError);
		});

		it('allows cosmetic field changes, new optional fields and removing fields', async () => {
			const { repos, resistors } = await tree();
			await repos.items.create({
				categoryId: resistors.id,
				name: '10k',
				attributes: { resistance: 10_000, tolerance: '1%' }
			});
			const updated = await repos.categories.update(resistors.id, {
				fieldDefs: [
					{
						key: 'resistance',
						label: 'Value',
						type: 'quantity',
						unit: 'Ω',
						showInList: true,
						order: 5
					},
					{ key: 'power_w', label: 'Power', type: 'number' }
				]
			});
			expect(updated.fieldDefs.map((d) => d.key)).toEqual(['resistance', 'power_w']);
			// removed field's data stays in the item
			expect((await repos.items.get('RES-0001')).attributes).toEqual({
				resistance: 10_000,
				tolerance: '1%'
			});
		});

		it.each([
			['type change', { key: 'resistance', label: 'R', type: 'text' }],
			[
				'newly required',
				{ key: 'tolerance', label: 'Tol', type: 'enum', options: ['1%', '5%'], required: true }
			],
			['option removed', { key: 'tolerance', label: 'Tol', type: 'enum', options: ['5%'] }]
		] satisfies [string, FieldDefInput][])(
			'refuses a %s that would invalidate stored values',
			async (_, def) => {
				const { repos, resistors } = await tree();
				await repos.items.create({
					categoryId: resistors.id,
					name: '10k',
					attributes: { resistance: 10_000, tolerance: '1%' }
				});
				await repos.items.create({
					categoryId: resistors.id,
					name: 'blank',
					attributes: { resistance: 1 }
				});
				const others = (await repos.categories.get(resistors.id)).fieldDefs.filter(
					(d) => d.key !== def.key
				);
				const err = await repos.categories
					.update(resistors.id, { fieldDefs: [...others, def] })
					.catch((e: unknown) => e);
				expect(err).toBeInstanceOf(FieldChangeConflictError);
				expect((err as FieldChangeConflictError).violations[0]).toMatchObject({ key: def.key });
			}
		);

		it('checks values in descendant categories when a parent field changes', async () => {
			const { repos, electronics, resistors } = await tree();
			await repos.items.create({
				categoryId: resistors.id,
				name: 'x',
				attributes: { manufacturer: 'Yageo' }
			});
			const err = await repos.categories
				.update(electronics.id, {
					fieldDefs: [{ key: 'manufacturer', label: 'M', type: 'enum', options: ['Vishay'] }]
				})
				.catch((e: unknown) => e);
			expect(err).toBeInstanceOf(FieldChangeConflictError);
			expect((err as FieldChangeConflictError).violations).toEqual([
				{ sku: 'RES-0001', key: 'manufacturer' }
			]);
		});

		it('checks leftover values of removed fields when a field is re-added', async () => {
			const { repos, resistors } = await tree();
			await repos.items.create({
				categoryId: resistors.id,
				name: 'x',
				attributes: { resistance: 1, tolerance: '1%' }
			});
			const withoutTolerance = (await repos.categories.get(resistors.id)).fieldDefs.filter(
				(d) => d.key !== 'tolerance'
			);
			await repos.categories.update(resistors.id, { fieldDefs: withoutTolerance });
			await expect(
				repos.categories.update(resistors.id, {
					fieldDefs: [...withoutTolerance, { key: 'tolerance', label: 'Tol', type: 'number' }]
				})
			).rejects.toBeInstanceOf(FieldChangeConflictError);
		});

		it('renames a field and moves stored values across the subtree', async () => {
			const { repos, electronics, resistors } = await tree();
			const item = await repos.items.create({
				categoryId: resistors.id,
				name: 'x',
				attributes: { manufacturer: 'Yageo', resistance: 1 }
			});
			const renamed = await repos.categories.renameField(electronics.id, 'manufacturer', 'brand');
			expect(renamed.fieldDefs.map((d) => d.key)).toEqual(['brand']);
			const after = await repos.items.get(item.sku);
			expect(after.attributes).toEqual({ brand: 'Yageo', resistance: 1 });
			expect(after.version).toBe(item.version + 1);
		});

		it('refuses invalid renames', async () => {
			const { repos, electronics, resistors } = await tree();
			await expect(repos.categories.renameField(resistors.id, 'manufacturer', 'x')).rejects.toThrow(
				/not declared/
			);
			await expect(
				repos.categories.renameField(electronics.id, 'manufacturer', 'resistance')
			).rejects.toBeInstanceOf(ConflictError);
			await expect(
				repos.categories.renameField(resistors.id, 'resistance', 'tolerance')
			).rejects.toBeInstanceOf(ConflictError);
			await expect(
				repos.categories.renameField(resistors.id, 'resistance', 'Bad Key')
			).rejects.toThrow();
		});
	});
});
