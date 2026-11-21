import { afterEach, beforeEach } from 'vitest';
import { createRepositories, type Repositories } from './repositories/index.ts';
import { createTestDatabase, type TestDatabase } from './testing.ts';

export interface Fixture {
	db: TestDatabase;
	repos: Repositories;
}

/** Fresh migrated database per test. Returns a getter because values are set in beforeEach. */
export function useTestDatabase(): () => Fixture {
	let fixture: Fixture | undefined;
	beforeEach(async () => {
		const db = await createTestDatabase();
		fixture = { db, repos: createRepositories(db) };
	});
	afterEach(async () => {
		await fixture?.db.cleanup();
		fixture = undefined;
	});
	return () => {
		if (!fixture) throw new Error('useTestDatabase() fixture used outside a test');
		return fixture;
	};
}

export async function createCountCategory(
	repos: Repositories,
	name = 'Resistors',
	prefix = 'RES-'
) {
	return repos.categories.create({
		name,
		skuPrefix: prefix,
		unitKind: 'count',
		displayUnit: 'pcs',
		fieldDefs: [
			{ key: 'resistance', label: 'Resistance', type: 'quantity', unit: 'Ω' },
			{ key: 'package', label: 'Package', type: 'enum', options: ['0603', 'THT'] },
			{ key: 'tags', label: 'Tags', type: 'multi_enum', options: ['smd', 'precision'] },
			{ key: 'rohs', label: 'RoHS', type: 'boolean' }
		]
	});
}
