import {
	attributeIssues,
	buildAttributesSchema,
	skuSchema,
	type Attributes,
	type FieldDef,
	type ItemWithAvailability
} from '@inventory/shared';
import { sql, type Kysely, type RawBuilder, type SqlBool } from 'kysely';
import type { ScalarValue } from '../dialect.ts';
import {
	AttributeValidationError,
	ConflictError,
	InvalidOperationError,
	NotFoundError,
	VersionConflictError
} from '../errors.ts';
import type { Database } from '../schema.ts';
import { buildSearchText, searchableKeys } from '../search.ts';
import { CategoryRepository } from './categories.ts';
import { inTransaction, withConstraintErrors, type RepoContext } from './context.ts';
import { applyStockDelta } from './stock.ts';

export interface CreateItemInput {
	/** Omit to generate one from the category's SKU prefix. */
	sku?: string;
	categoryId: number;
	name: string;
	description?: string | null;
	/** Initial stock in base units; recorded as a `receive` movement. */
	qtyOnHand?: number;
	qtyMin?: number | null;
	locationId?: number | null;
	barcode?: string | null;
	/** Validated against the category's resolved field definitions. */
	attributes?: Attributes;
}

/** `qtyOnHand` is deliberately absent: stock only changes through movements. SKUs are immutable. */
export interface UpdateItemInput {
	categoryId?: number;
	name?: string;
	description?: string | null;
	qtyMin?: number | null;
	locationId?: number | null;
	barcode?: string | null;
	/**
	 * Replaces the whole attributes object. Keys the item already has may be kept even if no
	 * field declares them any more (values of removed fields survive edits).
	 */
	attributes?: Attributes;
}

export type AttributeFilter =
	| { key: string; op: 'eq'; value: ScalarValue }
	| { key: string; op: 'contains'; value: string }
	| { key: string; op: 'gte' | 'lte'; value: number };

export type ItemSort = 'name' | 'sku' | 'qty' | 'updated';

export interface ItemFilter {
	q?: string;
	categoryIds?: number[];
	locationIds?: number[];
	/** Available quantity at or below qty_min. */
	lowStock?: boolean;
	includeArchived?: boolean;
	attributes?: AttributeFilter[];
	sort?: ItemSort;
	direction?: 'asc' | 'desc';
	limit?: number;
	offset?: number;
}

export interface ItemPage {
	items: ItemWithAvailability[];
	total: number;
}

const SORT_COLUMNS = {
	name: 'items.name',
	sku: 'items.sku',
	qty: 'items.qty_on_hand',
	updated: 'items.updated_at'
} as const;

const MAX_PAGE_SIZE = 500;

function normalizeBarcode(barcode: string | null | undefined): string | null {
	const trimmed = barcode?.trim();
	return trimmed ? trimmed : null;
}

function assertQty(value: number | null | undefined, name: string): void {
	if (value === null || value === undefined) return;
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new InvalidOperationError(`${name} must be a non-negative whole number of base units`);
	}
}

function validateAttributes(
	defs: readonly FieldDef[],
	attributes: Attributes,
	existingKeys: Iterable<string> = []
): Attributes {
	const result = buildAttributesSchema(defs, { allowUnknownKeys: existingKeys }).safeParse(
		attributes
	);
	if (result.success) return result.data;
	throw new AttributeValidationError(attributeIssues(result.error));
}

/** Items joined with the sum of their open reservations. */
function itemsWithReserved(db: Kysely<Database>) {
	const reserved = db
		.selectFrom('reservations')
		.select(['sku', sql<number>`cast(sum(qty_reserved) as bigint)`.as('reserved')])
		.where('status', '=', 'reserved')
		.groupBy('sku')
		.as('r');
	return db.selectFrom('items').leftJoin(reserved, 'r.sku', 'items.sku');
}

const ITEM_COLUMNS = [
	'items.sku',
	'items.category_id',
	'items.name',
	'items.description',
	'items.qty_on_hand',
	'items.qty_min',
	'items.location_id',
	'items.barcode',
	'items.attributes',
	'items.version',
	'items.archived_at',
	'items.created_at',
	'items.updated_at'
] as const;

export class ItemRepository {
	constructor(private readonly ctx: RepoContext) {}

	private select(db: Kysely<Database>) {
		return itemsWithReserved(db)
			.select(ITEM_COLUMNS)
			.select(sql<number>`coalesce(r.reserved, 0)`.as('qty_reserved'));
	}

	private toItem(
		row: Awaited<ReturnType<ReturnType<ItemRepository['select']>['executeTakeFirstOrThrow']>>
	): ItemWithAvailability {
		const qtyReserved = Number(row.qty_reserved);
		return {
			sku: row.sku,
			categoryId: row.category_id,
			name: row.name,
			description: row.description,
			qtyOnHand: row.qty_on_hand,
			qtyMin: row.qty_min,
			locationId: row.location_id,
			barcode: row.barcode,
			attributes: this.ctx.adapter.parseJson<Attributes>(row.attributes),
			version: row.version,
			archivedAt: row.archived_at,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			qtyReserved,
			qtyAvailable: row.qty_on_hand - qtyReserved
		};
	}

	async find(sku: string): Promise<ItemWithAvailability | undefined> {
		const row = await this.select(this.ctx.db).where('items.sku', '=', sku).executeTakeFirst();
		return row && this.toItem(row);
	}

	async get(sku: string): Promise<ItemWithAvailability> {
		const item = await this.find(sku);
		if (!item) throw new NotFoundError('Item', sku);
		return item;
	}

	async findByBarcode(barcode: string): Promise<ItemWithAvailability | undefined> {
		const code = normalizeBarcode(barcode);
		if (!code) return undefined;
		const row = await this.select(this.ctx.db).where('items.barcode', '=', code).executeTakeFirst();
		return row && this.toItem(row);
	}

	private conditions(filter: ItemFilter): RawBuilder<SqlBool>[] {
		const { adapter } = this.ctx;
		const conds: RawBuilder<SqlBool>[] = [];
		if (!filter.includeArchived) conds.push(sql<SqlBool>`${sql.ref('items.archived_at')} is null`);
		if (filter.categoryIds?.length) {
			conds.push(
				sql<SqlBool>`${sql.ref('items.category_id')} in (${sql.join(filter.categoryIds)})`
			);
		}
		if (filter.locationIds?.length) {
			conds.push(
				sql<SqlBool>`${sql.ref('items.location_id')} in (${sql.join(filter.locationIds)})`
			);
		}
		if (filter.lowStock) {
			conds.push(
				sql<SqlBool>`(${sql.ref('items.qty_min')} is not null and ${sql.ref('items.qty_on_hand')} - coalesce(${sql.ref('r.reserved')}, 0) <= ${sql.ref('items.qty_min')})`
			);
		}
		if (filter.q) {
			const match = adapter.itemTextMatch(filter.q);
			if (match) conds.push(match);
		}
		for (const f of filter.attributes ?? []) {
			switch (f.op) {
				case 'eq':
					conds.push(adapter.jsonEquals('items.attributes', f.key, f.value));
					break;
				case 'contains':
					conds.push(adapter.jsonArrayContains('items.attributes', f.key, f.value));
					break;
				case 'gte':
				case 'lte': {
					const field = adapter.jsonField('items.attributes', f.key, 'number');
					conds.push(
						f.op === 'gte'
							? sql<SqlBool>`${field} >= ${f.value}`
							: sql<SqlBool>`${field} <= ${f.value}`
					);
					break;
				}
			}
		}
		return conds;
	}

	/** Name and category of the given SKUs (missing SKUs are skipped). */
	async summaries(skus: string[]): Promise<{ sku: string; name: string; categoryId: number }[]> {
		if (skus.length === 0) return [];
		const rows = await this.ctx.db
			.selectFrom('items')
			.select(['sku', 'name', 'category_id'])
			.where('sku', 'in', skus)
			.execute();
		return rows.map((r) => ({ sku: r.sku, name: r.name, categoryId: r.category_id }));
	}

	async list(filter: ItemFilter = {}): Promise<ItemPage> {
		const conds = this.conditions(filter);
		const limit = Math.min(Math.max(filter.limit ?? 50, 1), MAX_PAGE_SIZE);
		const direction = filter.direction ?? 'asc';

		let rowsQuery = this.select(this.ctx.db);
		let countQuery = itemsWithReserved(this.ctx.db).select((eb) => eb.fn.countAll().as('total'));
		for (const cond of conds) {
			rowsQuery = rowsQuery.where(cond);
			countQuery = countQuery.where(cond);
		}

		const [rows, count] = await Promise.all([
			rowsQuery
				.orderBy(SORT_COLUMNS[filter.sort ?? 'name'], direction)
				.orderBy('items.sku', direction)
				.limit(limit)
				.offset(filter.offset ?? 0)
				.execute(),
			countQuery.executeTakeFirstOrThrow()
		]);
		return { items: rows.map((r) => this.toItem(r)), total: Number(count.total) };
	}

	/** Resolved field definitions of a category referenced by an item write. */
	private async fieldsOf(tx: RepoContext, categoryId: number): Promise<FieldDef[]> {
		try {
			return await new CategoryRepository(tx).resolvedFieldDefs(categoryId);
		} catch (err) {
			if (err instanceof NotFoundError) {
				throw new InvalidOperationError(`Category ${categoryId} does not exist`);
			}
			throw err;
		}
	}

	private async assertLocationExists(tx: RepoContext, locationId: number | null | undefined) {
		if (locationId === null || locationId === undefined) return;
		const row = await tx.db
			.selectFrom('locations')
			.select('id')
			.where('id', '=', locationId)
			.executeTakeFirst();
		if (!row) throw new InvalidOperationError(`Location ${locationId} does not exist`);
	}

	async create(input: CreateItemInput): Promise<ItemWithAvailability> {
		assertQty(input.qtyOnHand, 'qtyOnHand');
		assertQty(input.qtyMin, 'qtyMin');

		return inTransaction(this.ctx, async (tx) => {
			const defs = await this.fieldsOf(tx, input.categoryId);
			const attributes = validateAttributes(defs, input.attributes ?? {});
			await this.assertLocationExists(tx, input.locationId);

			const sku =
				input.sku !== undefined
					? skuSchema.parse(input.sku)
					: await new CategoryRepository(tx).nextSku(input.categoryId);
			const barcode = normalizeBarcode(input.barcode);
			await this.assertUnique(tx, sku, barcode);

			const name = input.name.trim();
			const description = input.description ?? null;
			const now = tx.now();

			await withConstraintErrors(tx, { unique: `SKU "${sku}" or barcode already exists` }, () =>
				tx.db
					.insertInto('items')
					.values({
						sku,
						category_id: input.categoryId,
						name,
						description,
						qty_min: input.qtyMin ?? null,
						location_id: input.locationId ?? null,
						barcode,
						attributes: tx.adapter.json(attributes),
						search_text: buildSearchText(
							{ sku, name, description, barcode, attributes },
							searchableKeys(defs)
						),
						created_at: now,
						updated_at: now
					})
					.execute()
			);

			if (input.qtyOnHand) {
				await applyStockDelta(tx, {
					sku,
					delta: input.qtyOnHand,
					reason: 'receive',
					note: 'Initial stock'
				});
			}
			return new ItemRepository(tx).get(sku);
		});
	}

	private async assertUnique(tx: RepoContext, sku: string, barcode: string | null): Promise<void> {
		const existing = await tx.db
			.selectFrom('items')
			.select('sku')
			.where('sku', '=', sku)
			.executeTakeFirst();
		if (existing) throw new ConflictError(`SKU "${sku}" already exists`);
		if (barcode) await this.assertBarcodeFree(tx, barcode);
	}

	private async assertBarcodeFree(tx: RepoContext, barcode: string, exceptSku?: string) {
		const owner = await tx.db
			.selectFrom('items')
			.select('sku')
			.where('barcode', '=', barcode)
			.$if(exceptSku !== undefined, (q) => q.where('sku', '!=', exceptSku!))
			.executeTakeFirst();
		if (owner) throw new ConflictError(`Barcode "${barcode}" is already assigned to ${owner.sku}`);
	}

	/**
	 * Update item details. Pass `expectedVersion` (from the item the user edited) to detect
	 * concurrent edits; stock movements do not change the version.
	 */
	async update(
		sku: string,
		patch: UpdateItemInput,
		expectedVersion?: number
	): Promise<ItemWithAvailability> {
		assertQty(patch.qtyMin, 'qtyMin');

		return inTransaction(this.ctx, async (tx) => {
			const current = await new ItemRepository(tx).get(sku);
			if (expectedVersion !== undefined && expectedVersion !== current.version) {
				throw new VersionConflictError(sku, expectedVersion, current.version);
			}

			const categoryId = patch.categoryId ?? current.categoryId;
			if (categoryId !== current.categoryId) {
				const categories = new CategoryRepository(tx);
				const from = await categories.get(current.categoryId);
				const to = await categories.find(categoryId);
				if (!to) throw new InvalidOperationError(`Category ${categoryId} does not exist`);
				if (from.unitKind !== to.unitKind) {
					throw new InvalidOperationError(
						`Cannot move an item from a "${from.unitKind}" category to a "${to.unitKind}" category`
					);
				}
			}
			if (patch.locationId !== undefined) await this.assertLocationExists(tx, patch.locationId);

			const defs = await this.fieldsOf(tx, categoryId);
			const attributes =
				patch.attributes !== undefined || categoryId !== current.categoryId
					? validateAttributes(
							defs,
							patch.attributes ?? current.attributes,
							Object.keys(current.attributes)
						)
					: current.attributes;

			const barcode =
				patch.barcode !== undefined ? normalizeBarcode(patch.barcode) : current.barcode;
			if (patch.barcode !== undefined && barcode) await this.assertBarcodeFree(tx, barcode, sku);

			const name = patch.name !== undefined ? patch.name.trim() : current.name;
			const description = patch.description !== undefined ? patch.description : current.description;

			const values: Record<string, unknown> = {
				category_id: categoryId,
				name,
				description,
				barcode,
				attributes: tx.adapter.json(attributes),
				search_text: buildSearchText(
					{ sku, name, description, barcode, attributes },
					searchableKeys(defs)
				),
				updated_at: tx.now()
			};
			if (patch.qtyMin !== undefined) values.qty_min = patch.qtyMin;
			if (patch.locationId !== undefined) values.location_id = patch.locationId;

			const updated = await withConstraintErrors(
				tx,
				{ unique: 'Barcode is already assigned' },
				() =>
					tx.db
						.updateTable('items')
						.set(values)
						.set((eb) => ({ version: eb('version', '+', 1) }))
						.where('sku', '=', sku)
						.where('version', '=', current.version)
						.executeTakeFirst()
			);
			if (updated.numUpdatedRows === 0n) {
				const now = await new ItemRepository(tx).get(sku);
				throw new VersionConflictError(sku, expectedVersion ?? current.version, now.version);
			}
			return new ItemRepository(tx).get(sku);
		});
	}

	async archive(sku: string): Promise<ItemWithAvailability> {
		return this.setArchived(sku, this.ctx.now());
	}

	async restore(sku: string): Promise<ItemWithAvailability> {
		return this.setArchived(sku, null);
	}

	private async setArchived(sku: string, archivedAt: string | null) {
		const result = await this.ctx.db
			.updateTable('items')
			.set({ archived_at: archivedAt, updated_at: this.ctx.now() })
			.where('sku', '=', sku)
			.executeTakeFirst();
		if (result.numUpdatedRows === 0n) throw new NotFoundError('Item', sku);
		return this.get(sku);
	}

	/** Hard delete, only for items without stock history or reservations. Prefer archive(). */
	async delete(sku: string): Promise<void> {
		await withConstraintErrors(
			this.ctx,
			{
				foreign_key: `Item ${sku} has stock history, reservations or is on a project parts list; archive it instead`
			},
			async () => {
				const result = await this.ctx.db
					.deleteFrom('items')
					.where('sku', '=', sku)
					.executeTakeFirst();
				if (result.numDeletedRows === 0n) throw new NotFoundError('Item', sku);
			}
		);
	}
}
