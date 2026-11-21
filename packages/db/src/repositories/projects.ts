import type { Project, ProjectStatus } from '@inventory/shared';
import type { Selectable } from 'kysely';
import { NotFoundError } from '../errors.ts';
import type { ProjectsTable } from '../schema.ts';
import type { RepoContext } from './context.ts';

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

	async update(id: number, patch: UpdateProjectInput): Promise<Project> {
		const values: Record<string, unknown> = { updated_at: this.ctx.now() };
		if (patch.name !== undefined) values.name = patch.name.trim();
		if (patch.description !== undefined) values.description = patch.description;
		if (patch.status !== undefined) values.status = patch.status;
		const row = await this.ctx.db
			.updateTable('projects')
			.set(values)
			.where('id', '=', id)
			.returningAll()
			.executeTakeFirst();
		if (!row) throw new NotFoundError('Project', id);
		return toProject(row);
	}

	/** Deletes the project and its reservations; stock movements keep their history (project_id → null). */
	async delete(id: number): Promise<void> {
		const result = await this.ctx.db.deleteFrom('projects').where('id', '=', id).executeTakeFirst();
		if (result.numDeletedRows === 0n) throw new NotFoundError('Project', id);
	}
}
