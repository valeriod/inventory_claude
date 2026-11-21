import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.ts';

const SECRET = 'x'.repeat(32);

describe('loadConfig', () => {
	it('applies safe defaults', () => {
		expect(loadConfig({})).toMatchObject({
			databaseUrl: 'sqlite://./data/inventory.db',
			host: '127.0.0.1',
			port: 3000,
			appPassword: undefined
		});
	});

	it('refuses a public bind without a password', () => {
		expect(() => loadConfig({ HOST: '0.0.0.0' })).toThrow(ConfigError);
	});

	it('allows a public bind with ALLOW_NO_AUTH', () => {
		expect(loadConfig({ HOST: '0.0.0.0', ALLOW_NO_AUTH: 'true' }).host).toBe('0.0.0.0');
	});

	it('allows a public bind with a password and secret', () => {
		const config = loadConfig({ HOST: '0.0.0.0', APP_PASSWORD: 'pw', SESSION_SECRET: SECRET });
		expect(config.appPassword).toBe('pw');
	});

	it('requires a long SESSION_SECRET when APP_PASSWORD is set', () => {
		expect(() => loadConfig({ APP_PASSWORD: 'pw', SESSION_SECRET: 'short' })).toThrow(
			/SESSION_SECRET/
		);
	});

	it('treats an empty APP_PASSWORD as unset', () => {
		expect(() => loadConfig({ HOST: '0.0.0.0', APP_PASSWORD: '' })).toThrow(/APP_PASSWORD/);
	});

	it('rejects an invalid port', () => {
		expect(() => loadConfig({ PORT: '99999' })).toThrow(/PORT/);
	});
});
