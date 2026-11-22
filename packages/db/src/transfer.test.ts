import { afterEach, describe, expect, it } from 'vitest';
import { InvalidOperationError } from './errors.ts';
import { connect } from './connect.ts';
import { migrateToLatest } from './migrate.ts';
import { createRepositories } from './repositories/index.ts';
import { seedDemoData } from './seed.ts';
import { createTestDatabase, type TestDatabase } from './testing.ts';
import { dumpDatabase, restoreDatabase } from './transfer.ts';

describe('dump and restore', () => {
	const open: TestDatabase[] = [];
	afterEach(async () => {
		for (const db of open.splice(0)) await db.cleanup();
	});
	async function database() {
		const db = await createTestDatabase();
		open.push(db);
		return db;
	}

	it('copies a database exactly, through JSON', async () => {
		const source = await database();
		const sourceRepos = createRepositories(source);
		await seedDemoData(sourceRepos);
		const project = (await sourceRepos.projects.list())[0]!;
		const r = await sourceRepos.reservations.reserve({
			projectId: project.id,
			sku: 'RES-0001',
			qty: 3
		});
		await sourceRepos.reservations.consume(r.id, { qty: 1 });

		const dump = JSON.parse(JSON.stringify(await dumpDatabase(source)));
		const target = await database();
		const counts = await restoreDatabase(target, dump);
		expect(counts.items).toBe(dump.tables.items.length);

		const copy = await dumpDatabase(target);
		expect({ ...copy, exportedAt: '' }).toEqual({ ...dump, exportedAt: '' });

		// Search, availability and new ids work in the copy
		const repos = createRepositories(target);
		const found = await repos.items.list({ q: 'hookup' });
		expect(found.total).toBe(2);
		expect((await repos.items.get('RES-0001')).qtyReserved).toBe(2);
		const maxId = Math.max(...dump.tables.categories.map((c: { id: number }) => c.id));
		const created = await repos.categories.create({
			name: 'New',
			unitKind: 'count',
			displayUnit: 'pcs'
		});
		expect(created.id).toBeGreaterThan(maxId);
		await repos.stock.adjust({ sku: 'RES-0001', delta: 1, reason: 'receive' });
	});

	it('refuses to restore into a database that has data, or a foreign file', async () => {
		const source = await database();
		await seedDemoData(createRepositories(source));
		const dump = await dumpDatabase(source);
		await expect(restoreDatabase(source, dump)).rejects.toBeInstanceOf(InvalidOperationError);
		const target = await database();
		await expect(restoreDatabase(target, { hello: 'world' })).rejects.toThrow(
			/Not an inventory export/
		);
	});

	it.runIf(process.env.TEST_DATABASE_URL?.startsWith('postgres'))(
		'moves data from SQLite to Postgres and back unchanged',
		async () => {
			const sqlite = connect('sqlite::memory:');
			await migrateToLatest(sqlite);
			try {
				await seedDemoData(createRepositories(sqlite));
				const original = await dumpDatabase(sqlite);

				const postgres = await database();
				await restoreDatabase(postgres, original);
				const viaPostgres = await dumpDatabase(postgres);
				expect(viaPostgres.tables).toEqual(original.tables);
				expect((await createRepositories(postgres).items.list({ q: 'hookup' })).total).toBe(2);

				const back = connect('sqlite::memory:');
				await migrateToLatest(back);
				await restoreDatabase(back, viaPostgres);
				expect((await dumpDatabase(back)).tables).toEqual(original.tables);
				await back.close();
			} finally {
				await sqlite.close();
			}
		}
	);
});
