import {
	fieldDefsSchema,
	formatSku,
	skuPrefixSchema,
	type Category,
	type FieldDef,
	type FieldDefInput,
	type UnitKind
} from '@inventory/shared';
import type { Selectable } from 'kysely';
import { ConflictError, InvalidOperationError, NotFoundError } from '../errors.ts';
import type { CategoriesTable } from '../schema.ts';
import { assertNoCycle, inTransaction, withConstraintErrors, type RepoContext } from './context.ts';

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

	private messages(name?: string, prefix?: string | null) {
		return {
			unique:
				prefix !== undefined
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

	async create(input: CreateCategoryInput): Promise<Category> {
		const fieldDefs = fieldDefsSchema.parse(input.fieldDefs ?? []);
		const skuPrefix = input.skuPrefix ? skuPrefixSchema.parse(input.skuPrefix) : null;
		const now = this.ctx.now();
		const row = await withConstraintErrors(this.ctx, this.messages(input.name, skuPrefix), () =>
			this.ctx.db
				.insertInto('categories')
				.values({
					name: input.name.trim(),
					parent_id: input.parentId ?? null,
					sku_prefix: skuPrefix,
					unit_kind: input.unitKind,
					display_unit: input.displayUnit,
					field_defs: this.ctx.adapter.json(fieldDefs),
					created_at: now,
					updated_at: now
				})
				.returningAll()
				.executeTakeFirstOrThrow()
		);
		return this.toCategory(row);
	}

	async update(id: number, patch: UpdateCategoryInput): Promise<Category> {
		return inTransaction(this.ctx, async (tx) => {
			const current = await new CategoryRepository(tx).get(id);

			if (patch.parentId !== undefined) await assertNoCycle(tx, 'categories', id, patch.parentId);

			if (patch.unitKind !== undefined && patch.unitKind !== current.unitKind) {
				const used = await tx.db
					.selectFrom('items')
					.select('sku')
					.where('category_id', '=', id)
					.limit(1)
					.executeTakeFirst();
				if (used) {
					throw new ConflictError(
						'The unit kind of a category cannot change while it has items (stored quantities would change meaning)'
					);
				}
			}

			const values: Record<string, unknown> = { updated_at: tx.now() };
			if (patch.name !== undefined) values.name = patch.name.trim();
			if (patch.parentId !== undefined) values.parent_id = patch.parentId;
			if (patch.skuPrefix !== undefined) {
				values.sku_prefix = patch.skuPrefix ? skuPrefixSchema.parse(patch.skuPrefix) : null;
			}
			if (patch.unitKind !== undefined) values.unit_kind = patch.unitKind;
			if (patch.displayUnit !== undefined) values.display_unit = patch.displayUnit;
			if (patch.fieldDefs !== undefined) {
				values.field_defs = tx.adapter.json(fieldDefsSchema.parse(patch.fieldDefs));
			}

			const row = await withConstraintErrors(
				tx,
				this.messages(patch.name ?? current.name, patch.skuPrefix),
				() =>
					tx.db
						.updateTable('categories')
						.set(values)
						.where('id', '=', id)
						.returningAll()
						.executeTakeFirstOrThrow()
			);
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
