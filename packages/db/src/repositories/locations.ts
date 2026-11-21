import { locationCodeSchema, type Location } from '@inventory/shared';
import type { Selectable } from 'kysely';
import { NotFoundError } from '../errors.ts';
import type { LocationsTable } from '../schema.ts';
import { assertNoCycle, inTransaction, withConstraintErrors, type RepoContext } from './context.ts';

export interface CreateLocationInput {
	name: string;
	code: string;
	parentId?: number | null;
	description?: string | null;
}

export type UpdateLocationInput = Partial<CreateLocationInput>;

function toLocation(row: Selectable<LocationsTable>): Location {
	return {
		id: row.id,
		name: row.name,
		parentId: row.parent_id,
		code: row.code,
		description: row.description,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export class LocationRepository {
	constructor(private readonly ctx: RepoContext) {}

	private messages(code?: string) {
		return {
			unique: `A location with code "${code}" already exists`,
			foreign_key: 'Parent location does not exist'
		};
	}

	async find(id: number): Promise<Location | undefined> {
		const row = await this.ctx.db
			.selectFrom('locations')
			.selectAll()
			.where('id', '=', id)
			.executeTakeFirst();
		return row && toLocation(row);
	}

	async get(id: number): Promise<Location> {
		const location = await this.find(id);
		if (!location) throw new NotFoundError('Location', id);
		return location;
	}

	async findByCode(code: string): Promise<Location | undefined> {
		const row = await this.ctx.db
			.selectFrom('locations')
			.selectAll()
			.where('code', '=', code.trim())
			.executeTakeFirst();
		return row && toLocation(row);
	}

	async list(): Promise<Location[]> {
		const rows = await this.ctx.db.selectFrom('locations').selectAll().orderBy('name').execute();
		return rows.map(toLocation);
	}

	async create(input: CreateLocationInput): Promise<Location> {
		const now = this.ctx.now();
		const code = locationCodeSchema.parse(input.code);
		const row = await withConstraintErrors(this.ctx, this.messages(code), () =>
			this.ctx.db
				.insertInto('locations')
				.values({
					name: input.name.trim(),
					code,
					parent_id: input.parentId ?? null,
					description: input.description ?? null,
					created_at: now,
					updated_at: now
				})
				.returningAll()
				.executeTakeFirstOrThrow()
		);
		return toLocation(row);
	}

	async update(id: number, patch: UpdateLocationInput): Promise<Location> {
		return inTransaction(this.ctx, async (tx) => {
			await new LocationRepository(tx).get(id);
			if (patch.parentId !== undefined) await assertNoCycle(tx, 'locations', id, patch.parentId);

			const values: Record<string, unknown> = { updated_at: tx.now() };
			if (patch.name !== undefined) values.name = patch.name.trim();
			if (patch.code !== undefined) values.code = locationCodeSchema.parse(patch.code);
			if (patch.parentId !== undefined) values.parent_id = patch.parentId;
			if (patch.description !== undefined) values.description = patch.description;

			const row = await withConstraintErrors(tx, this.messages(patch.code), () =>
				tx.db
					.updateTable('locations')
					.set(values)
					.where('id', '=', id)
					.returningAll()
					.executeTakeFirstOrThrow()
			);
			return toLocation(row);
		});
	}

	async delete(id: number): Promise<void> {
		await withConstraintErrors(
			this.ctx,
			{ foreign_key: 'Location still contains items or sub-locations' },
			async () => {
				const result = await this.ctx.db
					.deleteFrom('locations')
					.where('id', '=', id)
					.executeTakeFirst();
				if (result.numDeletedRows === 0n) throw new NotFoundError('Location', id);
			}
		);
	}
}
