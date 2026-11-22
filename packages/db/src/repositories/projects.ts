import type { Project, ProjectStatus, ProjectSummary } from '@inventory/shared';
import { sql, type Selectable } from 'kysely';
import { InvalidOperationError, NotFoundError } from '../errors.ts';
import type { ProjectsTable } from '../schema.ts';
import { inTransaction, type RepoContext } from './context.ts';

export interface CreateProjectInput {
	name: string;
	description?: string | null;
	status?: ProjectStatus;
}

export type UpdateProjectInput = Partial<CreateProjectInput>;

function toProject(row: Selectable<ProjectsTable>): Project {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export class ProjectRepository {
	constructor(private readonly ctx: RepoContext) {}

	async find(id: number): Promise<Project | undefined> {
		const row = await this.ctx.db
			.selectFrom('projects')
			.selectAll()
			.where('id', '=', id)
			.executeTakeFirst();
		return row && toProject(row);
	}

	async get(id: number): Promise<Project> {
		const project = await this.find(id);
		if (!project) throw new NotFoundError('Project', id);
		return project;
	}

	async list(filter: { status?: ProjectStatus[] } = {}): Promise<Project[]> {
		let query = this.ctx.db.selectFrom('projects').selectAll();
		if (filter.status?.length) query = query.where('status', 'in', filter.status);
		const rows = await query.orderBy('updated_at', 'desc').orderBy('id', 'desc').execute();
		return rows.map(toProject);
	}

	/** Reservation line counts per project. */
	private async summaries(
		ids: number[]
	): Promise<Map<number, Omit<ProjectSummary, keyof Project>>> {
		const result = new Map<number, Omit<ProjectSummary, keyof Project>>();
		if (ids.length === 0) return result;
		const rows = await this.ctx.db
			.selectFrom('reservations as r')
			.innerJoin('items as i', 'i.sku', 'r.sku')
			.select([
				'r.project_id',
				sql<number>`sum(case when r.status = 'reserved' then 1 else 0 end)`.as('open'),
				sql<number>`sum(case when r.status = 'reserved' and i.qty_on_hand < r.qty_reserved then 1 else 0 end)`.as(
					'short'
				),
				sql<number>`sum(case when r.status = 'consumed' then 1 else 0 end)`.as('consumed')
			])
			.where('r.project_id', 'in', ids)
			.groupBy('r.project_id')
			.execute();
		for (const row of rows) {
			result.set(row.project_id, {
				openLines: Number(row.open),
				shortLines: Number(row.short),
				consumedLines: Number(row.consumed)
			});
		}
		return result;
	}

	private async withSummaries(projects: Project[]): Promise<ProjectSummary[]> {
		const summaries = await this.summaries(projects.map((p) => p.id));
		return projects.map((p) => ({
			...p,
			...(summaries.get(p.id) ?? { openLines: 0, shortLines: 0, consumedLines: 0 })
		}));
	}

	async listWithSummary(filter: { status?: ProjectStatus[] } = {}): Promise<ProjectSummary[]> {
		return this.withSummaries(await this.list(filter));
	}

	async getWithSummary(id: number): Promise<ProjectSummary> {
		const [summary] = await this.withSummaries([await this.get(id)]);
		return summary!;
	}

	async create(input: CreateProjectInput): Promise<Project> {
		const now = this.ctx.now();
		const row = await this.ctx.db
			.insertInto('projects')
			.values({
				name: input.name.trim(),
				description: input.description ?? null,
				status: input.status ?? 'planning',
				created_at: now,
				updated_at: now
			})
			.returningAll()
			.executeTakeFirstOrThrow();
		return toProject(row);
	}

	/**
	 * A project can only be completed or cancelled once nothing is reserved for it any more, so
	 * closed projects never hold stock.
	 */
	async update(id: number, patch: UpdateProjectInput): Promise<Project> {
		return inTransaction(this.ctx, async (tx) => {
			if (patch.status === 'completed' || patch.status === 'cancelled') {
				const { open } = await tx.db
					.selectFrom('reservations')
					.select(sql<number>`count(*)`.as('open'))
					.where('project_id', '=', id)
					.where('status', '=', 'reserved')
					.executeTakeFirstOrThrow();
				if (Number(open) > 0) {
					throw new InvalidOperationError(
						`The project still has ${open} open reservation${Number(open) === 1 ? '' : 's'}; use or release ${Number(open) === 1 ? 'it' : 'them'} first`
					);
				}
			}
			const values: Record<string, unknown> = { updated_at: tx.now() };
			if (patch.name !== undefined) values.name = patch.name.trim();
			if (patch.description !== undefined) values.description = patch.description;
			if (patch.status !== undefined) values.status = patch.status;
			const row = await tx.db
				.updateTable('projects')
				.set(values)
				.where('id', '=', id)
				.returningAll()
				.executeTakeFirst();
			if (!row) throw new NotFoundError('Project', id);
			return toProject(row);
		});
	}

	/** Deletes the project and its reservations; stock movements keep their history (project_id → null). */
	async delete(id: number): Promise<void> {
		const result = await this.ctx.db.deleteFrom('projects').where('id', '=', id).executeTakeFirst();
		if (result.numDeletedRows === 0n) throw new NotFoundError('Project', id);
	}
}
