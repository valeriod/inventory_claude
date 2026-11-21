import type { Kysely } from 'kysely';
import type { DialectAdapter } from '../dialect.ts';
import { ConflictError, InvalidOperationError } from '../errors.ts';
import type { Database } from '../schema.ts';

export interface RepoContext {
	db: Kysely<Database>;
	adapter: DialectAdapter;
	/** Clock for created_at / updated_at; injectable for tests. */
	now: () => string;
}

/** Run `fn` in a transaction, or directly if `ctx` is already inside one. */
export async function inTransaction<T>(
	ctx: RepoContext,
	fn: (tx: RepoContext) => Promise<T>
): Promise<T> {
	if (ctx.db.isTransaction) return fn(ctx);
	return ctx.db.transaction().execute((trx) => fn({ ...ctx, db: trx }));
}

export interface ConstraintMessages {
	unique?: string;
	foreign_key?: string;
	check?: string;
}

/** Translate driver constraint violations into repository errors with readable messages. */
export async function withConstraintErrors<T>(
	ctx: RepoContext,
	messages: ConstraintMessages,
	fn: () => Promise<T>
): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		const kind = ctx.adapter.constraintViolation(err);
		const message = kind ? messages[kind] : undefined;
		if (kind && message) {
			throw kind === 'check' ? new InvalidOperationError(message) : new ConflictError(message);
		}
		throw err;
	}
}

/** Guard against cycles when re-parenting a node in a self-referencing tree. */
export async function assertNoCycle(
	ctx: RepoContext,
	table: 'categories' | 'locations',
	id: number,
	newParentId: number | null
): Promise<void> {
	let current = newParentId;
	const seen = new Set<number>();
	while (current !== null) {
		if (current === id) {
			throw new InvalidOperationError(`A ${table.slice(0, -1)} cannot be its own ancestor`);
		}
		if (seen.has(current)) break;
		seen.add(current);
		const row = await ctx.db
			.selectFrom(table)
			.select('parent_id')
			.where('id', '=', current)
			.executeTakeFirst();
		current = row?.parent_id ?? null;
	}
}
