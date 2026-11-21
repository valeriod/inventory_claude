import {
	fieldDefsSchema,
	fieldKeySchema,
	findFieldKeyConflicts,
	formatSku,
	isValidDisplayUnit,
	isValidFieldValue,
	resolveFieldDefs,
	skuPrefixSchema,
	subtreeIds,
	unitsFor,
	wouldCreateCycle,
	type Attributes,
	type Category,
	type CategoryWithFields,
	type FieldDef,
	type FieldDefInput,
	type UnitKind
} from '@inventory/shared';
import type { Selectable } from 'kysely';
import {
	ConflictError,
	FieldChangeConflictError,
	InvalidOperationError,
	NotFoundError,
	type FieldViolation
} from '../errors.ts';
import type { CategoriesTable } from '../schema.ts';
import { inTransaction, withConstraintErrors, type RepoContext } from './context.ts';
import { reindexItems } from './search-index.ts';

export interface CreateCategoryInput {
	name: string;
	parentId?: number | null;
	skuPrefix?: string | null;
	unitKind: UnitKind;
	displayUnit: string;
	fieldDefs?: FieldDefInput[];
}

export type UpdateCategoryInput = Partial<CreateCategoryInput>;

const MAX_SKU_ATTEMPTS = 1000;

/** Properties that affect whether a stored value is valid. */
const VALIDATION_PROPS = [
	'type',
	'required',
	'options',
	'min',
	'max',
	'integer',
	'maxLength',
	'pattern'
];

function validationSignature(def: FieldDef): string {
	const rec = def as unknown as Record<string, unknown>;
	return JSON.stringify(VALIDATION_PROPS.map((p) => rec[p] ?? null));
}

function assertDisplayUnit(unitKind: UnitKind, displayUnit: string): void {
	if (!isValidDisplayUnit(unitKind, displayUnit)) {
		throw new InvalidOperationError(
			`"${displayUnit}" is not a ${unitKind} unit (use ${unitsFor(unitKind).join(', ')})`
		);
	}
}

export class CategoryRepository {
	constructor(private readonly ctx: RepoContext) {}

	private toCategory(row: Selectable<CategoriesTable>): Category {
		return {
			id: row.id,
			name: row.name,
			parentId: row.parent_id,
			skuPrefix: row.sku_prefix,
			unitKind: row.unit_kind,
			displayUnit: row.display_unit,
			fieldDefs: this.ctx.adapter.parseJson<FieldDef[]>(row.field_defs),
			createdAt: row.created_at,
			updatedAt: row.updated_at
		};
	}

	private uniqueMessages(name: string | undefined, prefix: string | null | undefined) {
		return {
			unique: prefix
				? `A category named "${name}" or with SKU prefix "${prefix}" already exists`
				: `A category named "${name}" already exists`,
			foreign_key: 'Parent category does not exist'
		};
	}

	async find(id: number): Promise<Category | undefined> {
		const row = await this.ctx.db
			.selectFrom('categories')
			.selectAll()
			.where('id', '=', id)
			.executeTakeFirst();
		return row && this.toCategory(row);
	}

	async get(id: number): Promise<Category> {
		const category = await this.find(id);
		if (!category) throw new NotFoundError('Category', id);
		return category;
	}

	async list(): Promise<Category[]> {
		const rows = await this.ctx.db.selectFrom('categories').selectAll().orderBy('name').execute();
		return rows.map((r) => this.toCategory(r));
	}

	/** All categories with their resolved (inherited + own) field definitions. */
	async listWithFields(): Promise<CategoryWithFields[]> {
		const all = await this.list();
		return all.map((c) => ({ ...c, resolvedFieldDefs: resolveFieldDefs(all, c.id) }));
	}

	async getWithFields(id: number): Promise<CategoryWithFields> {
		const all = await this.list();
		const category = all.find((c) => c.id === id);
		if (!category) throw new NotFoundError('Category', id);
		return { ...category, resolvedFieldDefs: resolveFieldDefs(all, id) };
	}

	/** Fields that apply to items in this category (inherited first). */
	async resolvedFieldDefs(id: number): Promise<FieldDef[]> {
		return (await this.getWithFields(id)).resolvedFieldDefs;
	}

	private assertNoKeyConflicts(proposed: Category[]): void {
		const [conflict] = findFieldKeyConflicts(proposed);
		if (!conflict) return;
		const name = (id: number) => proposed.find((c) => c.id === id)?.name ?? `#${id}`;
		throw new ConflictError(
			`Field "${conflict.key}" is declared by both "${name(conflict.categoryIds[0])}" and its descendant "${name(conflict.categoryIds[1])}"`
		);
	}

	async create(input: CreateCategoryInput): Promise<Category> {
		const fieldDefs = fieldDefsSchema.parse(input.fieldDefs ?? []);
		const skuPrefix = input.skuPrefix ? skuPrefixSchema.parse(input.skuPrefix) : null;
		assertDisplayUnit(input.unitKind, input.displayUnit);

		return inTransaction(this.ctx, async (tx) => {
			const parentId = input.parentId ?? null;
			if (parentId !== null) {
				const all = await new CategoryRepository(tx).list();
				if (!all.some((c) => c.id === parentId)) {
					throw new InvalidOperationError('Parent category does not exist');
				}
				const now = tx.now();
				this.assertNoKeyConflicts([
					...all,
					{
						id: -1,
						name: input.name,
						parentId,
						skuPrefix,
						unitKind: input.unitKind,
						displayUnit: input.displayUnit,
						fieldDefs,
						createdAt: now,
						updatedAt: now
					}
				]);
			}

			const now = tx.now();
			const row = await withConstraintErrors(tx, this.uniqueMessages(input.name, skuPrefix), () =>
				tx.db
					.insertInto('categories')
					.values({
						name: input.name.trim(),
						parent_id: parentId,
						sku_prefix: skuPrefix,
						unit_kind: input.unitKind,
						display_unit: input.displayUnit,
						field_defs: tx.adapter.json(fieldDefs),
						created_at: now,
						updated_at: now
					})
					.returningAll()
					.executeTakeFirstOrThrow()
			);
			return this.toCategory(row);
		});
	}

	/** Items of the given categories with their attributes. */
	private async itemsIn(tx: RepoContext, categoryIds: number[]) {
		if (categoryIds.length === 0) return [];
		const rows = await tx.db
			.selectFrom('items')
			.select(['sku', 'category_id', 'attributes'])
			.where('category_id', 'in', categoryIds)
			.orderBy('sku')
			.execute();
		return rows.map((r) => ({
			sku: r.sku,
			categoryId: r.category_id,
			attributes: tx.adapter.parseJson<Attributes>(r.attributes)
		}));
	}

	/**
	 * Revalidate stored values for every field whose validation rules change (or that newly
	 * applies) in the subtree of `id` (plan §3.2 schema evolution).
	 */
	private async findViolations(
		tx: RepoContext,
		before: Category[],
		after: Category[],
		id: number
	): Promise<FieldViolation[]> {
		const changedByCategory = new Map<number, FieldDef[]>();
		for (const categoryId of subtreeIds(after, id)) {
			const old = new Map(resolveFieldDefs(before, categoryId).map((d) => [d.key, d]));
			const changed = resolveFieldDefs(after, categoryId).filter((d) => {
				const prev = old.get(d.key);
				return !prev || validationSignature(prev) !== validationSignature(d);
			});
			if (changed.length) changedByCategory.set(categoryId, changed);
		}

		const violations: FieldViolation[] = [];
		for (const item of await this.itemsIn(tx, [...changedByCategory.keys()])) {
			for (const def of changedByCategory.get(item.categoryId) ?? []) {
				if (!isValidFieldValue(def, item.attributes[def.key])) {
					violations.push({ sku: item.sku, key: def.key });
				}
			}
		}
		return violations;
	}

	async update(id: number, patch: UpdateCategoryInput): Promise<Category> {
		return inTransaction(this.ctx, async (tx) => {
			const all = await new CategoryRepository(tx).list();
			const current = all.find((c) => c.id === id);
			if (!current) throw new NotFoundError('Category', id);

			const next: Category = {
				...current,
				name: patch.name !== undefined ? patch.name.trim() : current.name,
				parentId: patch.parentId !== undefined ? patch.parentId : current.parentId,
				skuPrefix:
					patch.skuPrefix !== undefined
						? patch.skuPrefix
							? skuPrefixSchema.parse(patch.skuPrefix)
							: null
						: current.skuPrefix,
				unitKind: patch.unitKind ?? current.unitKind,
				displayUnit: patch.displayUnit ?? current.displayUnit,
				fieldDefs:
					patch.fieldDefs !== undefined
						? fieldDefsSchema.parse(patch.fieldDefs)
						: current.fieldDefs,
				updatedAt: tx.now()
			};

			assertDisplayUnit(next.unitKind, next.displayUnit);

			if (next.parentId !== current.parentId) {
				if (wouldCreateCycle(all, id, next.parentId)) {
					throw new InvalidOperationError('A category cannot be its own ancestor');
				}
				if (next.parentId !== null && !all.some((c) => c.id === next.parentId)) {
					throw new InvalidOperationError('Parent category does not exist');
				}
			}

			if (next.unitKind !== current.unitKind && (await this.itemsIn(tx, [id])).length > 0) {
				throw new ConflictError(
					'The unit kind of a category cannot change while it has items (stored quantities would change meaning)'
				);
			}

			const proposed = all.map((c) => (c.id === id ? next : c));
			if (patch.fieldDefs !== undefined || next.parentId !== current.parentId) {
				this.assertNoKeyConflicts(proposed);
				const violations = await this.findViolations(tx, all, proposed, id);
				if (violations.length) throw new FieldChangeConflictError(violations);
			}

			const row = await withConstraintErrors(
				tx,
				this.uniqueMessages(next.name, next.skuPrefix),
				() =>
					tx.db
						.updateTable('categories')
						.set({
							name: next.name,
							parent_id: next.parentId,
							sku_prefix: next.skuPrefix,
							unit_kind: next.unitKind,
							display_unit: next.displayUnit,
							field_defs: tx.adapter.json(next.fieldDefs),
							updated_at: next.updatedAt
						})
						.where('id', '=', id)
						.returningAll()
						.executeTakeFirstOrThrow()
			);
			if (patch.fieldDefs !== undefined || next.parentId !== current.parentId) {
				await reindexItems(tx, proposed, subtreeIds(proposed, id));
			}
			return this.toCategory(row);
		});
	}

	/**
	 * Rename a field declared on this category and move the stored values of all items in its
	 * subtree to the new key (plan §3.2 "guided migration").
	 */
	async renameField(id: number, fromKey: string, toKey: string): Promise<Category> {
		const newKey = fieldKeySchema.parse(toKey);
		return inTransaction(this.ctx, async (tx) => {
			const all = await new CategoryRepository(tx).list();
			const current = all.find((c) => c.id === id);
			if (!current) throw new NotFoundError('Category', id);
			if (!current.fieldDefs.some((d) => d.key === fromKey)) {
				throw new InvalidOperationError(`Field "${fromKey}" is not declared on "${current.name}"`);
			}
			if (fromKey === newKey) return current;

			const fieldDefs = current.fieldDefs.map((d) =>
				d.key === fromKey ? { ...d, key: newKey } : d
			);
			if (fieldDefs.filter((d) => d.key === newKey).length > 1) {
				throw new ConflictError(`"${current.name}" already has a field "${newKey}"`);
			}
			this.assertNoKeyConflicts(all.map((c) => (c.id === id ? { ...c, fieldDefs } : c)));

			const items = await this.itemsIn(tx, subtreeIds(all, id));
			const clash = items.find((i) => newKey in i.attributes);
			if (clash) {
				throw new ConflictError(
					`Item ${clash.sku} already stores a value under "${newKey}" (from a removed field)`
				);
			}

			const now = tx.now();
			for (const item of items) {
				if (!(fromKey in item.attributes)) continue;
				const { [fromKey]: value, ...rest } = item.attributes;
				await tx.db
					.updateTable('items')
					.set((eb) => ({
						attributes: tx.adapter.json({ ...rest, [newKey]: value }),
						version: eb('version', '+', 1),
						updated_at: now
					}))
					.where('sku', '=', item.sku)
					.execute();
			}

			const row = await tx.db
				.updateTable('categories')
				.set({ field_defs: tx.adapter.json(fieldDefs), updated_at: now })
				.where('id', '=', id)
				.returningAll()
				.executeTakeFirstOrThrow();
			const updated = all.map((c) => (c.id === id ? { ...c, fieldDefs } : c));
			await reindexItems(tx, updated, subtreeIds(updated, id));
			return this.toCategory(row);
		});
	}

	async delete(id: number): Promise<void> {
		await withConstraintErrors(
			this.ctx,
			{ foreign_key: 'Category still has items or sub-categories' },
			async () => {
				const result = await this.ctx.db
					.deleteFrom('categories')
					.where('id', '=', id)
					.executeTakeFirst();
				if (result.numDeletedRows === 0n) throw new NotFoundError('Category', id);
			}
		);
	}

	/** Reserve the next free SKU for this category: prefix + zero-padded sequence (plan §10). */
	async nextSku(id: number): Promise<string> {
		return inTransaction(this.ctx, async (tx) => {
			for (let attempt = 0; attempt < MAX_SKU_ATTEMPTS; attempt++) {
				const row = await tx.db
					.updateTable('categories')
					.set((eb) => ({ sku_seq: eb('sku_seq', '+', 1) }))
					.where('id', '=', id)
					.returning(['sku_seq', 'sku_prefix'])
					.executeTakeFirst();
				if (!row) throw new NotFoundError('Category', id);
				if (!row.sku_prefix) {
					throw new InvalidOperationError(
						'This category has no SKU prefix; enter a SKU manually or set a prefix'
					);
				}
				const sku = formatSku(row.sku_prefix, row.sku_seq);
				const taken = await tx.db
					.selectFrom('items')
					.select('sku')
					.where('sku', '=', sku)
					.executeTakeFirst();
				if (!taken) return sku;
			}
			throw new ConflictError('Could not find a free SKU for this category');
		});
	}
}
