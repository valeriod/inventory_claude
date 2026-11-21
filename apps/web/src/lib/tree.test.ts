import { describe, expect, it } from 'vitest';
import { descendantIds, flattenTree } from './tree.ts';

const nodes = [
	{ id: 1, parentId: null, name: 'Workshop' },
	{ id: 2, parentId: 1, name: 'Shelf B' },
	{ id: 3, parentId: 1, name: 'Shelf A' },
	{ id: 4, parentId: 3, name: 'Bin A1' },
	{ id: 5, parentId: null, name: 'Attic' },
	{ id: 6, parentId: 99, name: 'Orphan' }
];

describe('tree helpers', () => {
	it('flattens depth-first with sorted siblings and paths', () => {
		expect(flattenTree(nodes).map((e) => [e.node.id, e.depth, e.path])).toEqual([
			[5, 0, 'Attic'],
			[6, 0, 'Orphan'],
			[1, 0, 'Workshop'],
			[3, 1, 'Workshop › Shelf A'],
			[4, 2, 'Workshop › Shelf A › Bin A1'],
			[2, 1, 'Workshop › Shelf B']
		]);
	});

	it('collects descendants', () => {
		expect([...descendantIds(nodes, 1)].sort()).toEqual([1, 2, 3, 4]);
	});
});
