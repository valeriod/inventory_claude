import { serve } from '@hono/node-server';
import { connect, migrateToLatest } from '@inventory/db';
import { createApp } from './app.ts';
import { ConfigError, loadConfig } from './config.ts';
import { VERSION } from './version.ts';

async function main(): Promise<void> {
	const config = loadConfig();
	const conn = connect(config.databaseUrl);

	const applied = await migrateToLatest(conn);
	for (const m of applied) console.log(`migration ${m.migrationName}: ${m.status}`);

	const app = createApp({
		conn,
		staticDir: config.staticDir,
		auth: { password: config.appPassword, sessionSecret: config.sessionSecret }
	});
	const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
		console.log(
			`inventory ${VERSION} listening on http://${config.host}:${info.port} (${conn.dialect})`
		);
		console.log(
			config.appPassword ? 'Password protection enabled' : 'Password protection disabled'
		);
	});

	const shutdown = (signal: string) => {
		console.log(`${signal} received, shutting down`);
		server.close(() => {
			void conn.close().then(() => process.exit(0));
		});
		setTimeout(() => process.exit(1), 10_000).unref();
	};
	process.on('SIGINT', () => shutdown('SIGINT'));
	process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
	console.error(err instanceof ConfigError ? err.message : err);
	process.exit(1);
});
