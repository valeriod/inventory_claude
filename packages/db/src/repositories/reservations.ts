import type {
	PickLine,
	Reservation,
	ReservationStatus,
	ReservationWithProject
} from '@inventory/shared';
import { sql, type Selectable } from 'kysely';
import { InsufficientStockError, InvalidOperationError, NotFoundError } from '../errors.ts';
import type { ReservationsTable } from '../schema.ts';
import { inTransaction, type RepoContext } from './context.ts';
import { ProjectRepository } from './projects.ts';
import { applyStockDelta } from './stock.ts';

export interface ReserveInput {
	projectId: number;
	sku: string;
	/** Base units. */
	qty: number;
	note?: string | null;
}

export interface Availability {
	qtyOnHand: number;
	qtyReserved: number;
	qtyAvailable: number;
}

function toReservation(row: Selectable<ReservationsTable>): Reservation {
	return {
		id: row.id,
		projectId: row.project_id,
		sku: row.sku,
		qtyReserved: row.qty_reserved,
		status: row.status,
		note: row.note,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function assertPositive(qty: number): void {
	if (!Number.isSafeInteger(qty) || qty <= 0) {
		throw new InvalidOperationError(
			'Reserved quantity must be a positive whole number of base units'
		);
	}
}

/**
 * Parts set aside for projects (plan §3.1). Availability is on hand minus open reservations.
 * Availability checks lock the item row on Postgres (SQLite serializes writers), so concurrent
 * reservations cannot over-commit stock.
 */
export class ReservationRepository {
	constructor(private readonly ctx: RepoContext) {}

	async find(id: number): Promise<Reservation | undefined> {
		const row = await this.ctx.db
			.selectFrom('reservations')
			.selectAll()
			.where('id', '=', id)
			.executeTakeFirst();
		return row && toReservation(row);
	}

	async get(id: number): Promise<Reservation> {
		const reservation = await this.find(id);
		if (!reservation) throw new NotFoundError('Reservation', id);
		return reservation;
	}

	async listByProject(projectId: number, status?: ReservationStatus[]): Promise<Reservation[]> {
		let query = this.ctx.db
			.selectFrom('reservations')
			.selectAll()
			.where('project_id', '=', projectId);
		if (status?.length) query = query.where('status', 'in', status);
		const rows = await query.orderBy('sku').orderBy('id').execute();
		return rows.map(toReservation);
	}

	async listBySku(sku: string, status?: ReservationStatus[]): Promise<Reservation[]> {
		let query = this.ctx.db.selectFrom('reservations').selectAll().where('sku', '=', sku);
		if (status?.length) query = query.where('status', 'in', status);
		const rows = await query.orderBy('created_at').orderBy('id').execute();
		return rows.map(toReservation);
	}

	/** Reservations of an item with their project (newest first). */
	async listBySkuWithProject(
		sku: string,
		status?: ReservationStatus[]
	): Promise<ReservationWithProject[]> {
		let query = this.ctx.db
			.selectFrom('reservations as r')
			.innerJoin('projects as p', 'p.id', 'r.project_id')
			.selectAll('r')
			.select(['p.name as project_name', 'p.status as project_status'])
			.where('r.sku', '=', sku);
		if (status?.length) query = query.where('r.status', 'in', status);
		const rows = await query.orderBy('r.updated_at', 'desc').orderBy('r.id', 'desc').execute();
		return rows.map((row) => ({
			...toReservation(row),
			project: { id: row.project_id, name: row.project_name, status: row.project_status }
		}));
	}

	/**
	 * The lines of a project with item stock: open lines first (by location, then SKU), then
	 * consumed and released ones.
	 */
	async pickList(projectId: number): Promise<PickLine[]> {
		await new ProjectRepository(this.ctx).get(projectId);
		const rows = await this.ctx.db
			.selectFrom('reservations as r')
			.innerJoin('items as i', 'i.sku', 'r.sku')
			.selectAll('r')
			.select([
				'i.name as item_name',
				'i.category_id',
				'i.location_id',
				'i.qty_on_hand',
				'i.archived_at',
				(eb) =>
					eb
						.selectFrom('reservations as o')
						.select(sql<number>`cast(coalesce(sum(o.qty_reserved), 0) as bigint)`.as('total'))
						.whereRef('o.sku', '=', 'r.sku')
						.where('o.status', '=', 'reserved')
						.as('item_reserved')
			])
			.where('r.project_id', '=', projectId)
			.execute();
		const statusOrder: Record<ReservationStatus, number> = {
			reserved: 0,
			consumed: 1,
			released: 2
		};
		return rows
			.map((row): PickLine => {
				const reservation = toReservation(row);
				const open = reservation.status === 'reserved';
				return {
					...reservation,
					item: {
						name: row.item_name,
						categoryId: row.category_id,
						locationId: row.location_id,
						qtyOnHand: row.qty_on_hand,
						qtyAvailable: row.qty_on_hand - Number(row.item_reserved ?? 0),
						archivedAt: row.archived_at
					},
					shortBy: open ? Math.max(0, reservation.qtyReserved - row.qty_on_hand) : 0
				};
			})
			.sort(
				(a, b) =>
					statusOrder[a.status] - statusOrder[b.status] ||
					(a.item.locationId ?? Infinity) - (b.item.locationId ?? Infinity) ||
					a.sku.localeCompare(b.sku) ||
					a.id - b.id
			);
	}

	async availability(sku: string): Promise<Availability> {
		return inTransaction(this.ctx, (tx) => this.lockAndMeasure(tx, sku));
	}

	/** Lock the item (Postgres) and compute on hand / reserved, optionally excluding one reservation. */
	private async lockAndMeasure(
		tx: RepoContext,
		sku: string,
		excludeReservationId?: number
	): Promise<Availability> {
		const item = await tx.db
			.selectFrom('items')
			.select('qty_on_hand')
			.where('sku', '=', sku)
			.$if(tx.adapter.supportsRowLocks, (q) => q.forUpdate())
			.executeTakeFirst();
		if (!item) throw new NotFoundError('Item', sku);

		const { reserved } = await tx.db
			.selectFrom('reservations')
			.select(sql<number>`cast(coalesce(sum(qty_reserved), 0) as bigint)`.as('reserved'))
			.where('sku', '=', sku)
			.where('status', '=', 'reserved')
			.$if(excludeReservationId !== undefined, (q) => q.where('id', '!=', excludeReservationId!))
			.executeTakeFirstOrThrow();

		const qtyReserved = Number(reserved);
		return {
			qtyOnHand: item.qty_on_hand,
			qtyReserved,
			qtyAvailable: item.qty_on_hand - qtyReserved
		};
	}

	/**
	 * Reserve stock for a project. A second reservation of the same SKU for the same project is
	 * merged into the existing open reservation.
	 */
	async reserve(input: ReserveInput): Promise<Reservation> {
		assertPositive(input.qty);
		return inTransaction(this.ctx, async (tx) => {
			const project = await new ProjectRepository(tx).get(input.projectId);
			if (project.status === 'completed' || project.status === 'cancelled') {
				throw new InvalidOperationError(`Project "${project.name}" is ${project.status}`);
			}

			const { qtyAvailable } = await this.lockAndMeasure(tx, input.sku);
			if (input.qty > qtyAvailable) {
				throw new InsufficientStockError(input.sku, input.qty, Math.max(qtyAvailable, 0));
			}

			const now = tx.now();
			const existing = await tx.db
				.selectFrom('reservations')
				.selectAll()
				.where('project_id', '=', input.projectId)
				.where('sku', '=', input.sku)
				.where('status', '=', 'reserved')
				.executeTakeFirst();

			if (existing) {
				const row = await tx.db
					.updateTable('reservations')
					.set({
						qty_reserved: existing.qty_reserved + input.qty,
						note: input.note ?? existing.note,
						updated_at: now
					})
					.where('id', '=', existing.id)
					.returningAll()
					.executeTakeFirstOrThrow();
				return toReservation(row);
			}

			const row = await tx.db
				.insertInto('reservations')
				.values({
					project_id: input.projectId,
					sku: input.sku,
					qty_reserved: input.qty,
					status: 'reserved',
					note: input.note ?? null,
					created_at: now,
					updated_at: now
				})
				.returningAll()
				.executeTakeFirstOrThrow();
			return toReservation(row);
		});
	}

	/** Change the quantity of an open reservation. */
	async updateQty(id: number, qty: number): Promise<Reservation> {
		assertPositive(qty);
		return inTransaction(this.ctx, async (tx) => {
			const reservation = await this.getOpen(tx, id);
			const { qtyAvailable } = await this.lockAndMeasure(tx, reservation.sku, id);
			if (qty > qtyAvailable) {
				throw new InsufficientStockError(reservation.sku, qty, Math.max(qtyAvailable, 0));
			}
			return this.setFields(tx, id, { qty_reserved: qty });
		});
	}

	/** Return reserved stock to the available pool. */
	async release(id: number): Promise<Reservation> {
		return inTransaction(this.ctx, async (tx) => {
			await this.getOpen(tx, id);
			return this.setFields(tx, id, { status: 'released' });
		});
	}

	/**
	 * Take reserved parts out of stock with a `reserve_consume` movement. Without `qty` the whole
	 * reservation is consumed; with a smaller `qty` the rest stays reserved (partial pick).
	 */
	async consume(
		id: number,
		options: { qty?: number | undefined; note?: string | null | undefined } = {}
	): Promise<Reservation> {
		return inTransaction(this.ctx, async (tx) => {
			const reservation = await this.getOpen(tx, id);
			const qty = options.qty ?? reservation.qtyReserved;
			assertPositive(qty);
			if (qty > reservation.qtyReserved) {
				throw new InvalidOperationError(
					`Only ${reservation.qtyReserved} is reserved; record extra use as a normal stock movement`
				);
			}
			await applyStockDelta(tx, {
				sku: reservation.sku,
				delta: -qty,
				reason: 'reserve_consume',
				projectId: reservation.projectId,
				reservationId: id,
				note: options.note ?? null
			});
			return qty === reservation.qtyReserved
				? this.setFields(tx, id, { status: 'consumed' })
				: this.setFields(tx, id, { qty_reserved: reservation.qtyReserved - qty });
		});
	}

	/**
	 * Consume every open reservation of a project, all or nothing: if one line is short, nothing
	 * is taken out of stock.
	 */
	async consumeAll(projectId: number, note?: string | null): Promise<Reservation[]> {
		return inTransaction(this.ctx, async (tx) => {
			await new ProjectRepository(tx).get(projectId);
			const repo = new ReservationRepository(tx);
			const open = await repo.listByProject(projectId, ['reserved']);
			const consumed: Reservation[] = [];
			for (const r of open) consumed.push(await repo.consume(r.id, { note }));
			return consumed;
		});
	}

	/** Release every open reservation of a project; returns how many were released. */
	async releaseAll(projectId: number): Promise<number> {
		return inTransaction(this.ctx, async (tx) => {
			await new ProjectRepository(tx).get(projectId);
			const result = await tx.db
				.updateTable('reservations')
				.set({ status: 'released', updated_at: tx.now() })
				.where('project_id', '=', projectId)
				.where('status', '=', 'reserved')
				.executeTakeFirst();
			return Number(result.numUpdatedRows);
		});
	}

	private async getOpen(tx: RepoContext, id: number): Promise<Reservation> {
		const reservation = await new ReservationRepository(tx).get(id);
		if (reservation.status !== 'reserved') {
			throw new InvalidOperationError(`Reservation ${id} is already ${reservation.status}`);
		}
		return reservation;
	}

	private async setFields(
		tx: RepoContext,
		id: number,
		values: { qty_reserved?: number; status?: ReservationStatus }
	): Promise<Reservation> {
		const row = await tx.db
			.updateTable('reservations')
			.set({ ...values, updated_at: tx.now() })
			.where('id', '=', id)
			.returningAll()
			.executeTakeFirstOrThrow();
		return toReservation(row);
	}
}
