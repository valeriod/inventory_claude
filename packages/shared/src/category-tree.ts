import type { Category } from './domain.ts';
import type { FieldDef } from './fields.ts';

/** Minimal category shape needed for tree logic (works for partial/proposed data too). */
export type CategoryNode = Pick<Category, 'id' | 'parentId' | 'fieldDefs'> & { name?: string };

export type ResolvedFieldDef = FieldDef & {
	/** Category that declares this field (the category itself or an ancestor). */
	categoryId: number;
	inherited: boolean;
};

export type CategoryWithFields = Category & {
	/** Inherited and own fields that apply to items in this category. */
	resolvedFieldDefs: ResolvedFieldDef[];
};

/** Ancestors from the root down to the direct parent. Stops on cycles or missing parents. */
export function ancestorsOf<T extends CategoryNode>(all: readonly T[], id: number): T[] {
	const byId = new Map(all.map((c) => [c.id, c]));
	const chain: T[] = [];
	const seen = new Set<number>([id]);
	let parentId = byId.get(id)?.parentId ?? null;
	while (parentId !== null && !seen.has(parentId)) {
		const parent = byId.get(parentId);
		if (!parent) break;
		chain.unshift(parent);
		seen.add(parentId);
		parentId = parent.parentId;
	}
	return chain;
}

/** The category and all categories below it. */
export function subtreeIds(all: readonly CategoryNode[], id: number): number[] {
	const children = new Map<number, number[]>();
	for (const c of all) {
		if (c.parentId === null) continue;
		children.set(c.parentId, [...(children.get(c.parentId) ?? []), c.id]);
	}
	const result: number[] = [];
	const stack = [id];
	const seen = new Set<number>();
	while (stack.length) {
		const current = stack.pop()!;
		if (seen.has(current)) continue;
		seen.add(current);
		result.push(current);
		stack.push(...(children.get(current) ?? []));
	}
	return result;
}

/**
 * Fields that apply to items of a category: inherited fields first (root → parent), then the
 * category's own, each group sorted by `order` (plan §3.2 inheritance).
 */
export function resolveFieldDefs(all: readonly CategoryNode[], id: number): ResolvedFieldDef[] {
	const self = all.find((c) => c.id === id);
	if (!self) return [];
	return [...ancestorsOf(all, id), self].flatMap((c) =>
		[...c.fieldDefs]
			.sort((a, b) => a.order - b.order)
			.map((def) => ({ ...def, categoryId: c.id, inherited: c.id !== id }))
	);
}

export interface FieldKeyConflict {
	key: string;
	/** The two categories (ancestor first) that both declare the key. */
	categoryIds: [number, number];
}

/**
 * A key may be declared only once along any root-to-leaf path, otherwise a child would
 * silently shadow or contradict its parent's field.
 */
export function findFieldKeyConflicts(all: readonly CategoryNode[]): FieldKeyConflict[] {
	const conflicts: FieldKeyConflict[] = [];
	for (const category of all) {
		const ownKeys = new Set(category.fieldDefs.map((d) => d.key));
		for (const ancestor of ancestorsOf(all, category.id)) {
			for (const def of ancestor.fieldDefs) {
				if (ownKeys.has(def.key)) {
					conflicts.push({ key: def.key, categoryIds: [ancestor.id, category.id] });
				}
			}
		}
	}
	return conflicts;
}

/** Whether making `newParentId` the parent of `id` would create a cycle. */
export function wouldCreateCycle(
	all: readonly CategoryNode[],
	id: number,
	newParentId: number | null
): boolean {
	if (newParentId === null) return false;
	return newParentId === id || subtreeIds(all, id).includes(newParentId);
}
