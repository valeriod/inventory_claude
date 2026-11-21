import { resolveFieldDefs, type Attributes, type Category } from '@inventory/shared';
import { buildSearchText, searchableKeys } from '../search.ts';
import type { RepoContext } from './context.ts';

/**
 * Recompute `search_text` for all items in the given categories, e.g. after field definitions
 * changed (searchable flags, renamed keys, inherited fields).
 */
export async function reindexItems(
	tx: RepoContext,
	categories: readonly Category[],
	categoryIds: readonly number[]
): Promise<number> {
	if (categoryIds.length === 0) return 0;
	const keysByCategory = new Map(
		categoryIds.map((id) => [id, searchableKeys(resolveFieldDefs(categories, id))])
	);
	const rows = await tx.db
		.selectFrom('items')
		.select(['sku', 'category_id', 'name', 'description', 'barcode', 'attributes', 'search_text'])
		.where('category_id', 'in', [...categoryIds])
		.execute();

	let changed = 0;
	for (const row of rows) {
		const text = buildSearchText(
			{
				sku: row.sku,
				name: row.name,
				description: row.description,
				barcode: row.barcode,
				attributes: tx.adapter.parseJson<Attributes>(row.attributes)
			},
			keysByCategory.get(row.category_id)
		);
		if (text === row.search_text) continue;
		await tx.db
			.updateTable('items')
			.set({ search_text: text })
			.where('sku', '=', row.sku)
			.execute();
		changed++;
	}
	return changed;
}
