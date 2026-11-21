import type { Attributes } from '@inventory/shared';

const MAX_QUERY_TOKENS = 10;

/**
 * Normalize text into search tokens: lower-case, diacritics removed, split on anything that is
 * not a letter or digit. The same function builds `items.search_text` and tokenizes queries, so
 * SQLite FTS5 and Postgres tsvector both index plain space-separated alphanumeric tokens and
 * behave the same way.
 */
export function tokenize(text: string): string[] {
	return (
		text
			.normalize('NFKD')
			.replace(/\p{M}/gu, '')
			.toLowerCase()
			.match(/[\p{L}\p{N}]+/gu) ?? []
	);
}

export function queryTokens(query: string): string[] {
	return [...new Set(tokenize(query))].slice(0, MAX_QUERY_TOKENS);
}

export interface SearchableItem {
	sku: string;
	name: string;
	description: string | null;
	barcode: string | null;
	attributes: Attributes;
}

/**
 * @param searchableKeys attribute keys to index (fields with `searchable: true`). When omitted,
 *   every attribute value is indexed.
 */
export function buildSearchText(
	item: SearchableItem,
	searchableKeys?: ReadonlySet<string>
): string {
	const parts: string[] = [item.sku, item.name, item.description ?? '', item.barcode ?? ''];
	for (const [key, value] of Object.entries(item.attributes)) {
		if (searchableKeys && !searchableKeys.has(key)) continue;
		if (value === null || typeof value === 'boolean') continue;
		parts.push(Array.isArray(value) ? value.join(' ') : String(value));
	}
	return [...new Set(tokenize(parts.join(' ')))].join(' ');
}

/** Keys of the fields whose values should be indexed for search. */
export function searchableKeys(defs: readonly { key: string; searchable: boolean }[]): Set<string> {
	return new Set(defs.filter((d) => d.searchable).map((d) => d.key));
}
