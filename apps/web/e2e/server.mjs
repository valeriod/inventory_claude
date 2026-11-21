// Starts the production API (serving the built PWA) on a fresh, seeded SQLite database.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = process.argv[2] ?? '4173';
const here = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(here, '..');
const apiDir = resolve(webDir, '../api');
const server = join(apiDir, 'dist/server.js');
const staticDir = join(webDir, 'build');

for (const path of [server, join(staticDir, '200.html')]) {
	if (!existsSync(path)) {
		console.error(`Missing ${path}. Run "pnpm build" before the end-to-end tests.`);
		process.exit(1);
	}
}

const env = {
	...process.env,
	DATABASE_URL: `sqlite://${join(mkdtempSync(join(tmpdir(), 'inventory-e2e-')), 'e2e.db')}`,
	HOST: '127.0.0.1',
	PORT: port,
	STATIC_DIR: staticDir,
	APP_PASSWORD: 'e2e-password',
	SESSION_SECRET: 'e2e-session-secret-0123456789abcdef'
};

const seed = spawnSync('pnpm', ['exec', 'tsx', 'src/seed.ts'], {
	cwd: apiDir,
	env,
	stdio: 'inherit'
});
if (seed.status !== 0) process.exit(seed.status ?? 1);

const child = spawn(process.execPath, [server], { cwd: apiDir, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
