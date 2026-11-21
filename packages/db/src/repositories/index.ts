import type { Kysely } from 'kysely';
import type { DialectAdapter } from '../dialect.ts';
import type { Database } from '../schema.ts';
import { CategoryRepository } from './categories.ts';
import type { RepoContext } from './context.ts';
import { ItemRepository } from './items.ts';
import { LocationRepository } from './locations.ts';
import { ProjectRepository } from './projects.ts';
import { ReservationRepository } from './reservations.ts';
import { StockRepository } from './stock.ts';

export interface Repositories {
	categories: CategoryRepository;
	locations: LocationRepository;
	projects: ProjectRepository;
	items: ItemRepository;
	stock: StockRepository;
	reservations: ReservationRepository;
	/** Run several repository calls atomically. */
	transaction<T>(fn: (repos: Repositories) => Promise<T>): Promise<T>;
}

export interface RepositoryOptions {
	now?: () => string;
}

function build(ctx: RepoContext): Repositories {
	return {
		categories: new CategoryRepository(ctx),
		locations: new LocationRepository(ctx),
		projects: new ProjectRepository(ctx),
		items: new ItemRepository(ctx),
		stock: new StockRepository(ctx),
		reservations: new ReservationRepository(ctx),
		transaction: (fn) =>
			ctx.db.isTransaction
				? fn(build(ctx))
				: ctx.db.transaction().execute((trx) => fn(build({ ...ctx, db: trx })))
	};
}

export function createRepositories(
	conn: { db: Kysely<Database>; adapter: DialectAdapter },
	options: RepositoryOptions = {}
): Repositories {
	return build({
		db: conn.db,
		adapter: conn.adapter,
		now: options.now ?? (() => new Date().toISOString())
	});
}

export type {
	AttributeFilter,
	CreateItemInput,
	ItemFilter,
	ItemPage,
	ItemSort,
	UpdateItemInput
} from './items.ts';
export type { CreateCategoryInput, UpdateCategoryInput } from './categories.ts';
export type { CreateLocationInput, UpdateLocationInput } from './locations.ts';
export type { CreateProjectInput, UpdateProjectInput } from './projects.ts';
export type { Availability, ReserveInput } from './reservations.ts';
export type { CountResult, MovementFilter, StockChangeInput, StockChangeResult } from './stock.ts';
export {
	CategoryRepository,
	ItemRepository,
	LocationRepository,
	ProjectRepository,
	ReservationRepository,
	StockRepository
};
