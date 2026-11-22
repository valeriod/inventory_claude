import { bomQuantities, type BomLine, type ProjectPart } from '@inventory/shared';
import { sql, type Selectable } from 'kysely';
import { InvalidOperationError, NotFoundError } from '../errors.ts';
import type { ProjectPartsTable } from '../schema.ts';
import { inTransaction, type RepoContext } from './context.ts';
import { ProjectRepository } from './projects.ts';
import { ReservationRepository } from './reservations.ts';

function toPart(row: Selectable<ProjectPartsTable>): ProjectPart {
	return {
		id: row.id,
		projectId: row.project_id,
		sku: row.sku,
		qtyNeeded: row.qty_needed,
		note: row.note,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

/** Movement reasons that count as parts used by a project. */
const USE_REASONS = ['consume', 'reserve_consume'] as const;

/**
 * A project's parts list (needed quantities) and the bill of materials that combines it with
 * reservations, use and stock.
 */
export class ProjectPartRepository {
	constructor(private readonly ctx: RepoContext) {}

	async list(projectId: number): Promise<ProjectPart[]> {
		const rows = await this.ctx.db
			.selectFrom('project_parts')
			.selectAll()
			.where('project_id', '=', projectId)
			.orderBy('sku')
			.execute();
		return rows.map(toPart);
	}

	/** Create or replace the need for an item. */
	async set(input: {
		projectId: number;
		sku: string;
		qtyNeeded: number;
		note?: string | null | undefined;
	}): Promise<ProjectPart> {
		if (!Number.isSafeInteger(input.qtyNeeded) || input.qtyNeeded <= 0) {
			throw new InvalidOperationError(
				'Needed quantity must be a positive whole number of base units'
			);
		}
		return inTransaction(this.ctx, async (tx) => {
			await new ProjectRepository(tx).get(input.projectId);
			const item = await tx.db
				.selectFrom('items')
				.select('sku')
				.where('sku', '=', input.sku)
				.executeTakeFirst();
			if (!item) throw new NotFoundError('Item', input.sku);
			const now = tx.now();
			const existing = await tx.db
				.selectFrom('project_parts')
				.select('id')
				.where('project_id', '=', input.projectId)
				.where('sku', '=', input.sku)
				.executeTakeFirst();
			const row = existing
				? await tx.db
						.updateTable('project_parts')
						.set({
							qty_needed: input.qtyNeeded,
							...(input.note !== undefined && { note: input.note }),
							updated_at: now
						})
						.where('id', '=', existing.id)
						.returningAll()
						.executeTakeFirstOrThrow()
				: await tx.db
						.insertInto('project_parts')
						.values({
							project_id: input.projectId,
							sku: input.sku,
							qty_needed: input.qtyNeeded,
							note: input.note ?? null,
							created_at: now,
							updated_at: now
						})
						.returningAll()
						.executeTakeFirstOrThrow();
			return toPart(row);
		});
	}

	/** Remove an item from the parts list (its reservations and use stay). */
	async remove(projectId: number, sku: string): Promise<void> {
		const result = await this.ctx.db
			.deleteFrom('project_parts')
			.where('project_id', '=', projectId)
			.where('sku', '=', sku)
			.executeTakeFirst();
		if (result.numDeletedRows === 0n) throw new NotFoundError('Project part', sku);
	}

	/**
	 * Bill of materials: every item that is on the parts list, reserved (open) or used by the
	 * project, ordered by item name.
	 */
	async bom(projectId: number): Promise<BomLine[]> {
		await new ProjectRepository(this.ctx).get(projectId);
		const db = this.ctx.db;
		const [parts, reservations, used] = await Promise.all([
			this.list(projectId),
			db
				.selectFrom('reservations')
				.select(['id', 'sku', 'qty_reserved'])
				.where('project_id', '=', projectId)
				.where('status', '=', 'reserved')
				.execute(),
			db
				.selectFrom('stock_movements')
				.select(['sku', sql<number>`cast(coalesce(sum(-delta), 0) as bigint)`.as('used')])
				.where('project_id', '=', projectId)
				.where('reason', 'in', USE_REASONS)
				.groupBy('sku')
				.execute()
		]);
		const skus = [
			...new Set([
				...parts.map((p) => p.sku),
				...reservations.map((r) => r.sku),
				...used.map((u) => u.sku)
			])
		];
		if (skus.length === 0) return [];

		const items = await db
			.selectFrom('items as i')
			.select([
				'i.sku',
				'i.name',
				'i.category_id',
				'i.location_id',
				'i.qty_on_hand',
				'i.archived_at',
				(eb) =>
					eb
						.selectFrom('reservations as o')
						.select(sql<number>`cast(coalesce(sum(o.qty_reserved), 0) as bigint)`.as('total'))
						.whereRef('o.sku', '=', 'i.sku')
						.where('o.status', '=', 'reserved')
						.as('reserved_total')
			])
			.where('i.sku', 'in', skus)
			.execute();

		const partBySku = new Map(parts.map((p) => [p.sku, p]));
		const reservationBySku = new Map(reservations.map((r) => [r.sku, r]));
		const usedBySku = new Map(used.map((u) => [u.sku, Number(u.used)]));

		return items
			.map((i): BomLine => {
				const part = partBySku.get(i.sku);
				const reservation = reservationBySku.get(i.sku);
				const available = i.qty_on_hand - Number(i.reserved_total ?? 0);
				const qtyUsed = usedBySku.get(i.sku) ?? 0;
				const qtyReserved = reservation?.qty_reserved ?? 0;
				const q = bomQuantities({
					needed: part?.qtyNeeded ?? null,
					used: qtyUsed,
					reserved: qtyReserved,
					onHand: i.qty_on_hand,
					available
				});
				return {
					sku: i.sku,
					item: {
						name: i.name,
						categoryId: i.category_id,
						locationId: i.location_id,
						qtyOnHand: i.qty_on_hand,
						qtyAvailable: available,
						archivedAt: i.archived_at
					},
					qtyNeeded: part?.qtyNeeded ?? null,
					note: part?.note ?? null,
					qtyUsed,
					qtyReserved,
					reservationId: reservation?.id ?? null,
					qtyRemaining: q.remaining,
					qtyCanReserve: q.canReserve,
					qtyToBuy: q.toBuy
				};
			})
			.sort((a, b) => a.item.name.localeCompare(b.item.name) || a.sku.localeCompare(b.sku));
	}

	/**
	 * Reserve, for every line of the parts list, as much of the remaining need as available stock
	 * covers. Returns the number of lines that got a reservation.
	 */
	async reserveNeeded(projectId: number): Promise<number> {
		return inTransaction(this.ctx, async (tx) => {
			const repo = new ProjectPartRepository(tx);
			const reservations = new ReservationRepository(tx);
			let count = 0;
			for (const line of await repo.bom(projectId)) {
				if (line.qtyCanReserve > 0 && !line.item.archivedAt) {
					await reservations.reserve({ projectId, sku: line.sku, qty: line.qtyCanReserve });
					count++;
				}
			}
			return count;
		});
	}
}
