import type { MovementReason, StockMovement } from '@inventory/shared';
import type { Selectable } from 'kysely';
import { InsufficientStockError, InvalidOperationError, NotFoundError } from '../errors.ts';
import type { StockMovementsTable } from '../schema.ts';
import { inTransaction, type RepoContext } from './context.ts';

export interface StockChangeInput {
	sku: string;
	/** Signed change in base units. */
	delta: number;
	reason: MovementReason;
	projectId?: number | null;
	reservationId?: number | null;
	note?: string | null;
}

export interface StockChangeResult {
	qtyOnHand: number;
	movement: StockMovement;
}

export interface CountResult {
	qtyOnHand: number;
	/** null when the count matched the recorded quantity. */
	movement: StockMovement | null;
}

export interface MovementFilter {
	sku?: string;
	projectId?: number;
	reasons?: MovementReason[];
	/** Inclusive lower bound, ISO timestamp. */
	from?: string;
	/** Exclusive upper bound, ISO timestamp. */
	to?: string;
	limit?: number;
	offset?: number;
}

const REASON_SIGN: Record<MovementReason, 'positive' | 'negative' | 'any'> = {
	receive: 'positive',
	consume: 'negative',
	reserve_consume: 'negative',
	adjust: 'any',
	count: 'any'
};

export function toMovement(row: Selectable<StockMovementsTable>): StockMovement {
	return {
		id: row.id,
		sku: row.sku,
		delta: row.delta,
		reason: row.reason,
		projectId: row.project_id,
		reservationId: row.reservation_id,
		note: row.note,
		createdAt: row.created_at
	};
}

function assertQuantity(value: number, name: string): void {
	if (!Number.isSafeInteger(value)) {
		throw new InvalidOperationError(`${name} must be a whole number of base units`);
	}
}

/**
 * The only way stock changes: a guarded atomic UPDATE plus a ledger row, in one transaction
 * (plan §3.1, §4). The WHERE clause re-checks `qty_on_hand + delta >= 0` at write time, so
 * concurrent decrements can never drive stock negative.
 */
export async function applyStockDelta(
	ctx: RepoContext,
	input: StockChangeInput
): Promise<StockChangeResult> {
	assertQuantity(input.delta, 'delta');
	if (input.delta === 0) throw new InvalidOperationError('delta must not be zero');
	const sign = REASON_SIGN[input.reason];
	if (sign === 'positive' && input.delta < 0) {
		throw new InvalidOperationError(`"${input.reason}" requires a positive delta`);
	}
	if (sign === 'negative' && input.delta > 0) {
		throw new InvalidOperationError(`"${input.reason}" requires a negative delta`);
	}

	return inTransaction(ctx, async (tx) => {
		if (input.projectId !== undefined && input.projectId !== null) {
			const project = await tx.db
				.selectFrom('projects')
				.select('id')
				.where('id', '=', input.projectId)
				.executeTakeFirst();
			if (!project) throw new InvalidOperationError(`Project ${input.projectId} does not exist`);
		}
		const now = tx.now();
		const updated = await tx.db
			.updateTable('items')
			.set((eb) => ({ qty_on_hand: eb('qty_on_hand', '+', input.delta), updated_at: now }))
			.where('sku', '=', input.sku)
			.where((eb) => eb(eb('qty_on_hand', '+', input.delta), '>=', 0))
			.returning('qty_on_hand')
			.executeTakeFirst();

		if (!updated) {
			const item = await tx.db
				.selectFrom('items')
				.select('qty_on_hand')
				.where('sku', '=', input.sku)
				.executeTakeFirst();
			if (!item) throw new NotFoundError('Item', input.sku);
			throw new InsufficientStockError(input.sku, -input.delta, item.qty_on_hand);
		}

		const movement = await tx.db
			.insertInto('stock_movements')
			.values({
				sku: input.sku,
				delta: input.delta,
				reason: input.reason,
				project_id: input.projectId ?? null,
				reservation_id: input.reservationId ?? null,
				note: input.note ?? null,
				created_at: now
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		return { qtyOnHand: updated.qty_on_hand, movement: toMovement(movement) };
	});
}

export class StockRepository {
	constructor(private readonly ctx: RepoContext) {}

	/** Receive, consume or adjust stock. */
	adjust(input: StockChangeInput): Promise<StockChangeResult> {
		return applyStockDelta(this.ctx, input);
	}

	/** Record a physical count; writes a `count` movement for the difference, if any. */
	async count(input: {
		sku: string;
		countedQty: number;
		note?: string | null;
	}): Promise<CountResult> {
		assertQuantity(input.countedQty, 'countedQty');
		if (input.countedQty < 0) throw new InvalidOperationError('countedQty must not be negative');

		return inTransaction(this.ctx, async (tx) => {
			const item = await tx.db
				.selectFrom('items')
				.select('qty_on_hand')
				.where('sku', '=', input.sku)
				.$if(tx.adapter.supportsRowLocks, (q) => q.forUpdate())
				.executeTakeFirst();
			if (!item) throw new NotFoundError('Item', input.sku);

			const delta = input.countedQty - item.qty_on_hand;
			if (delta === 0) return { qtyOnHand: item.qty_on_hand, movement: null };
			return applyStockDelta(tx, {
				sku: input.sku,
				delta,
				reason: 'count',
				note: input.note ?? null
			});
		});
	}

	/** Newest first. */
	async movements(filter: MovementFilter = {}): Promise<StockMovement[]> {
		let query = this.ctx.db.selectFrom('stock_movements').selectAll();
		if (filter.sku !== undefined) query = query.where('sku', '=', filter.sku);
		if (filter.projectId !== undefined) query = query.where('project_id', '=', filter.projectId);
		if (filter.reasons?.length) query = query.where('reason', 'in', filter.reasons);
		if (filter.from !== undefined) query = query.where('created_at', '>=', filter.from);
		if (filter.to !== undefined) query = query.where('created_at', '<', filter.to);
		const rows = await query
			.orderBy('created_at', 'desc')
			.orderBy('id', 'desc')
			.limit(Math.min(filter.limit ?? 100, 1000))
			.offset(filter.offset ?? 0)
			.execute();
		return rows.map(toMovement);
	}
}
