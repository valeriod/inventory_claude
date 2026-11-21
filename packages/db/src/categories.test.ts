import { describe, expect, it } from 'vitest';
import { ConflictError, InvalidOperationError, NotFoundError } from './errors.ts';
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
		expect((await repos.categories.update(cat.id, { unitKind: 'length' })).unitKind).toBe('length');
		await repos.categories.update(cat.id, { unitKind: 'count' });
		await repos.items.create({ categoryId: cat.id, name: 'x' });
		await expect(repos.categories.update(cat.id, { unitKind: 'mass' })).rejects.toBeInstanceOf(
			ConflictError
		);
		// display unit may change freely
		expect((await repos.categories.update(cat.id, { displayUnit: 'ea' })).displayUnit).toBe('ea');
	});

	it('refuses to delete a category that is in use', async () => {
		const { repos } = fx();
		const cat = await createCountCategory(repos);
		await repos.items.create({ categoryId: cat.id, name: 'x' });
		await expect(repos.categories.delete(cat.id)).rejects.toBeInstanceOf(ConflictError);
		await expect(repos.categories.delete(9999)).rejects.toBeInstanceOf(NotFoundError);
	});
});
