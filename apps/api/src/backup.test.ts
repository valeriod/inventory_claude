import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { connect, createRepositories, migrateToLatest } from '@inventory/db';
import { describe, expect, it } from 'vitest';
import { backupNow, msUntilHour, pruneBackups } from './backup.ts';
import { useApi } from './test-helpers.ts';

describe('backups', () => {
	const api = useApi({ seed: true });

	it('writes a restorable backup for the current database', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'inventory-backup-'));
		const file = await backupNow(api().db, { dir, keep: 5, now: new Date(2026, 10, 21, 3, 0, 0) });
		expect(file).toMatch(/inventory-20261121-030000\.(db|json\.gz)$/);
		if (file.endsWith('.db')) {
			const copy = connect(`sqlite://${file}`);
			await migrateToLatest(copy);
			expect((await createRepositories(copy).items.list({})).total).toBeGreaterThan(5);
			await copy.close();
		} else {
			const dump = JSON.parse(gunzipSync(readFileSync(file)).toString());
			expect(dump.tables.items.length).toBeGreaterThan(5);
		}
	});

	it('keeps only the newest backups', () => {
		const dir = mkdtempSync(join(tmpdir(), 'inventory-prune-'));
		for (const d of ['20261101', '20261102', '20261103']) {
			writeFileSync(join(dir, `inventory-${d}-030000.db`), '');
		}
		writeFileSync(join(dir, 'notes.txt'), '');
		expect(pruneBackups(dir, 2)).toEqual(['inventory-20261101-030000.db']);
		expect(readdirSync(dir).sort()).toEqual([
			'inventory-20261102-030000.db',
			'inventory-20261103-030000.db',
			'notes.txt'
		]);
		expect(existsSync(join(dir, 'notes.txt'))).toBe(true);
	});

	it('schedules the next run at the given hour', () => {
		expect(msUntilHour(3, new Date(2026, 0, 1, 2, 30))).toBe(30 * 60_000);
		expect(msUntilHour(3, new Date(2026, 0, 1, 3, 0))).toBe(24 * 3600_000);
	});
});
