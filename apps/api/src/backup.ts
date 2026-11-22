import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { dumpDatabase, vacuumInto, type DatabaseConnection } from '@inventory/db';

/**
 * Backups (plan §8.2): SQLite is copied with `VACUUM INTO` (a consistent, compact .db file that
 * can replace the live one); Postgres is exported as gzipped JSON, restorable with
 * `db:transfer`. Old backups beyond `keep` are deleted.
 */
const NAME = /^inventory-\d{8}-\d{6}\.(db|json\.gz)$/;

function stamp(date: Date): string {
	const p = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

export async function backupNow(
	conn: DatabaseConnection,
	options: { dir: string; keep: number; now?: Date }
): Promise<string> {
	mkdirSync(options.dir, { recursive: true });
	const base = join(options.dir, `inventory-${stamp(options.now ?? new Date())}`);
	let file: string;
	if (conn.dialect === 'sqlite') {
		file = `${base}.db`;
		await vacuumInto(conn, file);
	} else {
		file = `${base}.json.gz`;
		writeFileSync(file, gzipSync(JSON.stringify(await dumpDatabase(conn))));
	}
	pruneBackups(options.dir, options.keep);
	return file;
}

/** Keep the newest `keep` backups (by name, which sorts by time). */
export function pruneBackups(dir: string, keep: number): string[] {
	const files = readdirSync(dir)
		.filter((f) => NAME.test(f))
		.sort();
	const removed = files.slice(0, Math.max(0, files.length - keep));
	for (const f of removed) rmSync(join(dir, f));
	return removed;
}

/** Milliseconds until the next local `hour`:00. */
export function msUntilHour(hour: number, now = new Date()): number {
	const next = new Date(now);
	next.setHours(hour, 0, 0, 0);
	if (next <= now) next.setDate(next.getDate() + 1);
	return next.getTime() - now.getTime();
}

/** Run a backup every day at `hour`; returns a function that stops the schedule. */
export function scheduleBackups(
	conn: DatabaseConnection,
	options: { dir: string; keep: number; hour: number },
	log: (message: string) => void = console.log
): () => void {
	let timer: NodeJS.Timeout;
	const run = async () => {
		try {
			log(`backup written: ${await backupNow(conn, options)}`);
		} catch (err) {
			console.error('backup failed:', err);
		}
		timer = setTimeout(run, msUntilHour(options.hour));
		timer.unref();
	};
	timer = setTimeout(run, msUntilHour(options.hour));
	timer.unref();
	log(`nightly backups at ${options.hour}:00 to ${options.dir} (keeping ${options.keep})`);
	return () => clearTimeout(timer);
}
