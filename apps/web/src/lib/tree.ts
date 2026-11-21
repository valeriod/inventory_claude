export interface TreeNode {
	id: number;
	parentId: number | null;
	name: string;
}

export interface FlatTreeEntry<T extends TreeNode> {
	node: T;
	depth: number;
	/** Names from the root to this node, e.g. "Electronics › Passives › Resistors". */
	path: string;
}

/** Depth-first, alphabetically sorted flattening of a parent/child list (for indented selects). */
export function flattenTree<T extends TreeNode>(nodes: readonly T[]): FlatTreeEntry<T>[] {
	const ids = new Set(nodes.map((n) => n.id));
	const children = new Map<number | null, T[]>();
	for (const n of nodes) {
		const parent = n.parentId !== null && ids.has(n.parentId) ? n.parentId : null;
		children.set(parent, [...(children.get(parent) ?? []), n]);
	}
	for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name));

	const out: FlatTreeEntry<T>[] = [];
	const seen = new Set<number>();
	const walk = (parent: number | null, depth: number, prefix: string) => {
		for (const node of children.get(parent) ?? []) {
			if (seen.has(node.id)) continue;
			seen.add(node.id);
			const path = prefix ? `${prefix} › ${node.name}` : node.name;
			out.push({ node, depth, path });
			walk(node.id, depth + 1, path);
		}
	};
	walk(null, 0, '');
	return out;
}

/** The node and all its descendants. */
export function descendantIds(nodes: readonly TreeNode[], id: number): Set<number> {
	const result = new Set<number>([id]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const n of nodes) {
			if (n.parentId !== null && result.has(n.parentId) && !result.has(n.id)) {
				result.add(n.id);
				grew = true;
			}
		}
	}
	return result;
}
