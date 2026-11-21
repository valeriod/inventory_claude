import type { Reservation, ReservationStatus } from '@inventory/shared';
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

	/** Take the reserved parts out of stock: writes a `reserve_consume` movement. */
	async consume(id: number, note?: string | null): Promise<Reservation> {
		return inTransaction(this.ctx, async (tx) => {
			const reservation = await this.getOpen(tx, id);
			await applyStockDelta(tx, {
				sku: reservation.sku,
				delta: -reservation.qtyReserved,
				reason: 'reserve_consume',
				projectId: reservation.projectId,
				reservationId: id,
				note: note ?? null
			});
			return this.setFields(tx, id, { status: 'consumed' });
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
