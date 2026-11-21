import { describe, expect, it } from 'vitest';
import {
	ancestorsOf,
	findFieldKeyConflicts,
	resolveFieldDefs,
	subtreeIds,
	wouldCreateCycle,
	type CategoryNode
} from './category-tree.ts';
import { fieldDefsSchema, type FieldDefInput } from './fields.ts';

const f = (...defs: FieldDefInput[]) => fieldDefsSchema.parse(defs);

// Electronics(1) → Passives(2) → Resistors(3), Capacitors(4); Wire(5)
const tree: CategoryNode[] = [
	{ id: 1, parentId: null, fieldDefs: f({ key: 'manufacturer', label: 'Mfr', type: 'text' }) },
	{ id: 2, parentId: 1, fieldDefs: f({ key: 'package', label: 'Pkg', type: 'text' }) },
	{
		id: 3,
		parentId: 2,
		fieldDefs: f(
			{ key: 'tolerance', label: 'Tol', type: 'text', order: 2 },
			{ key: 'resistance', label: 'R', type: 'quantity', unit: 'Ω', order: 1 }
		)
	},
	{
		id: 4,
		parentId: 2,
		fieldDefs: f({ key: 'capacitance', label: 'C', type: 'quantity', unit: 'F' })
	},
	{ id: 5, parentId: null, fieldDefs: f({ key: 'color', label: 'Colour', type: 'text' }) }
];

describe('category tree', () => {
	it('lists ancestors root-first', () => {
		expect(ancestorsOf(tree, 3).map((c) => c.id)).toEqual([1, 2]);
		expect(ancestorsOf(tree, 1)).toEqual([]);
	});

	it('lists a subtree', () => {
		expect(subtreeIds(tree, 2).sort()).toEqual([2, 3, 4]);
		expect(subtreeIds(tree, 5)).toEqual([5]);
	});

	it('resolves inherited fields root-first, own fields sorted by order', () => {
		const resolved = resolveFieldDefs(tree, 3);
		expect(resolved.map((d) => [d.key, d.categoryId, d.inherited])).toEqual([
			['manufacturer', 1, true],
			['package', 2, true],
			['resistance', 3, false],
			['tolerance', 3, false]
		]);
		expect(resolveFieldDefs(tree, 999)).toEqual([]);
	});

	it('detects keys declared twice on one path, but allows them in sibling branches', () => {
		expect(findFieldKeyConflicts(tree)).toEqual([]);
		const sibling = tree.map((c) =>
			c.id === 5 ? { ...c, fieldDefs: f({ key: 'package', label: 'x', type: 'text' }) } : c
		);
		expect(findFieldKeyConflicts(sibling)).toEqual([]);
		const shadowing = tree.map((c) =>
			c.id === 3 ? { ...c, fieldDefs: f({ key: 'manufacturer', label: 'x', type: 'text' }) } : c
		);
		expect(findFieldKeyConflicts(shadowing)).toEqual([
			{ key: 'manufacturer', categoryIds: [1, 3] }
		]);
	});

	it('detects cycles', () => {
		expect(wouldCreateCycle(tree, 1, 3)).toBe(true);
		expect(wouldCreateCycle(tree, 1, 1)).toBe(true);
		expect(wouldCreateCycle(tree, 3, 4)).toBe(false);
		expect(wouldCreateCycle(tree, 3, null)).toBe(false);
	});

	it('survives corrupt cyclic data', () => {
		const cyclic: CategoryNode[] = [
			{ id: 1, parentId: 2, fieldDefs: [] },
			{ id: 2, parentId: 1, fieldDefs: [] }
		];
		expect(ancestorsOf(cyclic, 1).map((c) => c.id)).toEqual([2]);
		expect(subtreeIds(cyclic, 1).sort()).toEqual([1, 2]);
	});
});
