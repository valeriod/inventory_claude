import { z } from 'zod';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

const booleanFromEnv = z
	.enum(['true', 'false', '1', '0', ''])
	.default('false')
	.transform((v) => v === 'true' || v === '1');

const envSchema = z
	.object({
		DATABASE_URL: z.string().min(1).default('sqlite://./data/inventory.db'),
		HOST: z.string().min(1).default('127.0.0.1'),
		PORT: z.coerce.number().int().min(1).max(65535).default(3000),
		PUBLIC_URL: z.url().optional(),
		APP_PASSWORD: z
			.string()
			.optional()
			.transform((v) => (v === '' ? undefined : v)),
		SESSION_SECRET: z
			.string()
			.optional()
			.transform((v) => (v === '' ? undefined : v)),
		ALLOW_NO_AUTH: booleanFromEnv,
		/** Set behind a reverse proxy so the login rate limit sees real client addresses. */
		TRUST_PROXY: booleanFromEnv,
		STATIC_DIR: z.string().optional(),
		/** Nightly backups are written here when set (the Docker image sets /data/backups). */
		BACKUP_DIR: z
			.string()
			.optional()
			.transform((v) => (v === '' ? undefined : v)),
		BACKUP_KEEP: z.coerce.number().int().min(1).max(3650).default(14),
		/** Local hour (0–23) at which the nightly backup runs. */
		BACKUP_HOUR: z.coerce.number().int().min(0).max(23).default(3)
	})
	.superRefine((env, ctx) => {
		if (env.APP_PASSWORD && (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)) {
			ctx.addIssue({
				code: 'custom',
				path: ['SESSION_SECRET'],
				message: 'SESSION_SECRET (32+ characters) is required when APP_PASSWORD is set'
			});
		}
		if (!LOCAL_HOSTS.has(env.HOST) && !env.APP_PASSWORD && !env.ALLOW_NO_AUTH) {
			ctx.addIssue({
				code: 'custom',
				path: ['HOST'],
				message: `Refusing to listen on ${env.HOST} without APP_PASSWORD. Set APP_PASSWORD, or ALLOW_NO_AUTH=true if the network is trusted (e.g. Tailscale).`
			});
		}
	});

export type Config = {
	databaseUrl: string;
	host: string;
	port: number;
	publicUrl: string | undefined;
	appPassword: string | undefined;
	sessionSecret: string | undefined;
	trustProxy: boolean;
	staticDir: string | undefined;
	backup: { dir: string; keep: number; hour: number } | undefined;
};

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const result = envSchema.safeParse(env);
	if (!result.success) {
		const details = result.error.issues
			.map((i) => `  - ${i.path.join('.') || '(env)'}: ${i.message}`)
			.join('\n');
		throw new ConfigError(`Invalid configuration:\n${details}`);
	}
	const e = result.data;
	return {
		databaseUrl: e.DATABASE_URL,
		host: e.HOST,
		port: e.PORT,
		publicUrl: e.PUBLIC_URL,
		appPassword: e.APP_PASSWORD,
		sessionSecret: e.SESSION_SECRET,
		trustProxy: e.TRUST_PROXY,
		staticDir: e.STATIC_DIR,
		backup: e.BACKUP_DIR
			? { dir: e.BACKUP_DIR, keep: e.BACKUP_KEEP, hour: e.BACKUP_HOUR }
			: undefined
	};
}
