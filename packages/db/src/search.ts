// Search normalization lives in @inventory/shared so the PWA can search its offline catalogue
// exactly like the database does.
export {
	buildSearchText,
	queryTokens,
	searchableKeys,
	tokenize,
	type SearchableItem
} from '@inventory/shared';
