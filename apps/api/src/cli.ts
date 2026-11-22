// Maintenance commands (also bundled as dist/cli.js in the Docker image):
//   transfer --from <db-url|file.json[.gz]> --to <db-url|file.json[.gz]>
//   backup [--dir <dir>] [--keep <n>]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { gunzipSync, gzipSync } from 'node:zlib';
import { connect, dumpDatabase, migrateToLatest, restoreDatabase, type Dump } from '@inventory/db';
import { backupNow } from './backup.ts';
import { loadConfig } from './config.ts';

const USAGE = `Usage:
  cli transfer --from <database-url | file.json[.gz]> --to <database-url | file.json[.gz]>
      Copy all data. The target database must be empty (it is migrated first).
      Database URLs: sqlite:///path/to/inventory.db, postgres://user:pass@host:5432/db
  cli backup [--dir <directory>] [--keep <n>]
      Write a backup now (default: BACKUP_DIR, keeping BACKUP_KEEP files).`;

const isFile = (target: string) => /\.json(\.gz)?$/i.test(target);

async function readSource(from: string): Promise<Dump> {
	if (isFile(from)) {
		const raw = readFileSync(from);
		return JSON.parse((from.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8')) as Dump;
	}
	const conn = connect(from);
	try {
		await migrateToLatest(conn);
		return await dumpDatabase(conn);
	} finally {
		await conn.close();
	}
}

async function writeTarget(to: string, dump: Dump): Promise<string> {
	if (isFile(to)) {
		const json = JSON.stringify(dump);
		writeFileSync(to, to.endsWith('.gz') ? gzipSync(json) : json);
		return `wrote ${to}`;
	}
	const conn = connect(to);
	try {
		await migrateToLatest(conn);
		const counts = await restoreDatabase(conn, dump);
		return Object.entries(counts)
			.map(([table, n]) => `${table}: ${n}`)
			.join(', ');
	} finally {
		await conn.close();
	}
}

async function main(argv: string[]): Promise<void> {
	const [command, ...rest] = argv;
	const { values } = parseArgs({
		args: rest,
		options: {
			from: { type: 'string' },
			to: { type: 'string' },
			dir: { type: 'string' },
			keep: { type: 'string' }
		}
	});
	if (command === 'transfer') {
		if (!values.from || !values.to) throw new Error(USAGE);
		const dump = await readSource(values.from);
		console.log(await writeTarget(values.to, dump));
	} else if (command === 'backup') {
		const config = loadConfig();
		const dir = values.dir ?? config.backup?.dir;
		if (!dir) throw new Error('Set BACKUP_DIR or pass --dir');
		const keep = values.keep ? Number(values.keep) : (config.backup?.keep ?? 14);
		const conn = connect(config.databaseUrl);
		try {
			await migrateToLatest(conn);
			console.log(`backup written: ${await backupNow(conn, { dir, keep })}`);
		} finally {
			await conn.close();
		}
	} else {
		throw new Error(USAGE);
	}
}

main(process.argv.slice(2)).catch((err: unknown) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
