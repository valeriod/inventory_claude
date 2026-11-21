import type { AttributeFilter, ItemFilter, Repositories } from '@inventory/db';
import {
	FIELD_KEY_PATTERN,
	listItemsQuerySchema,
	resolveFieldDefs,
	subtreeIds,
	type FieldDef,
	type FieldType
} from '@inventory/shared';
import { BadRequestError } from './errors.ts';

const ATTR_PARAM = /^attr\.([^[\]]+)(?:\[(eq|gte|lte|contains)\])?$/;
const NUMERIC: ReadonlySet<FieldType> = new Set(['number', 'quantity']);

type Op = AttributeFilter['op'];

function defaultOp(type: FieldType): Op {
	return type === 'multi_enum' ? 'contains' : 'eq';
}

function toFilter(key: string, op: Op, raw: string, type: FieldType): AttributeFilter {
	const invalid = (why: string) => new BadRequestError(`attr.${key}[${op}]: ${why}`);
	if (NUMERIC.has(type)) {
		if (op === 'contains') throw invalid('not supported for numeric fields');
		const value = Number(raw);
		if (raw.trim() === '' || !Number.isFinite(value)) throw invalid(`"${raw}" is not a number`);
		return { key, op, value };
	}
	if (type === 'boolean') {
		if (op !== 'eq') throw invalid('only equality is supported for yes/no fields');
		if (raw !== 'true' && raw !== 'false') throw invalid('use true or false');
		return { key, op, value: raw === 'true' };
	}
	if (type === 'multi_enum') {
		if (op !== 'contains') throw invalid('use [contains] for multi-select fields');
		return { key, op, value: raw };
	}
	if (op !== 'eq') throw invalid('only equality is supported for this field');
	return { key, op, value: raw };
}

/**
 * Translate GET /api/items query parameters into a repository filter. Attribute filters
 * (`attr.color=red`, `attr.gauge_awg[gte]=18`, `attr.tags[contains]=smd`) are typed using the
 * field definitions of the selected category subtree (or all categories).
 */
export async function parseItemQuery(
	repos: Repositories,
	params: URLSearchParams
): Promise<{ filter: ItemFilter; page: number; pageSize: number }> {
	const fixed: Record<string, string> = {};
	const attrParams: [string, string][] = [];
	for (const [name, value] of params) {
		if (name.startsWith('attr.')) attrParams.push([name, value]);
		else fixed[name] = value;
	}
	const query = listItemsQuerySchema.parse(fixed);

	const filter: ItemFilter = {
		lowStock: query.lowStock,
		includeArchived: query.includeArchived,
		sort: query.sort,
		direction: query.dir,
		limit: query.pageSize,
		offset: (query.page - 1) * query.pageSize
	};
	if (query.q) filter.q = query.q;

	const needCategories = query.category !== undefined || attrParams.length > 0;
	const categories = needCategories ? await repos.categories.list() : [];
	let scope = categories.map((c) => c.id);
	if (query.category !== undefined) {
		if (!categories.some((c) => c.id === query.category)) {
			throw new BadRequestError(`Category ${query.category} does not exist`);
		}
		scope = query.subcategories ? subtreeIds(categories, query.category) : [query.category];
		filter.categoryIds = scope;
	}

	if (query.location !== undefined) {
		const locations = await repos.locations.list();
		if (!locations.some((l) => l.id === query.location)) {
			throw new BadRequestError(`Location ${query.location} does not exist`);
		}
		filter.locationIds = query.sublocations
			? subtreeIds(
					locations.map((l) => ({ ...l, fieldDefs: [] })),
					query.location
				)
			: [query.location];
	}

	if (attrParams.length) {
		const defsByKey = new Map<string, FieldDef[]>();
		for (const id of scope) {
			for (const def of resolveFieldDefs(categories, id)) {
				defsByKey.set(def.key, [...(defsByKey.get(def.key) ?? []), def]);
			}
		}
		filter.attributes = attrParams.map(([name, value]) => {
			const match = ATTR_PARAM.exec(name);
			const key = match?.[1];
			if (!match || !key || !FIELD_KEY_PATTERN.test(key)) {
				throw new BadRequestError(`Invalid attribute filter "${name}"`);
			}
			const types = new Set((defsByKey.get(key) ?? []).map((d) => d.type));
			if (types.size === 0)
				throw new BadRequestError(`Unknown field "${key}" for the selected categories`);
			const numericOnly = [...types].every((t) => NUMERIC.has(t));
			if (types.size > 1 && !numericOnly) {
				throw new BadRequestError(
					`Field "${key}" has different types in different categories; filter by category first`
				);
			}
			const type = [...types][0]!;
			return toFilter(key, (match[2] as Op | undefined) ?? defaultOp(type), value, type);
		});
	}

	return { filter, page: query.page, pageSize: query.pageSize };
}
