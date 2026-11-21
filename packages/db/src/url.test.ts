import { describe, expect, it } from 'vitest';
import { parseDatabaseUrl } from './url.ts';

describe('parseDatabaseUrl', () => {
	it.each([
		['sqlite::memory:', ':memory:'],
		['sqlite://./data/inventory.db', './data/inventory.db'],
		['sqlite:///data/inventory.db', '/data/inventory.db'],
		['sqlite:data/inventory.db', 'data/inventory.db']
	])('parses %s', (url, filename) => {
		expect(parseDatabaseUrl(url)).toEqual({ dialect: 'sqlite', filename });
	});

	it.each(['postgres://u:p@localhost/db', 'postgresql://u:p@localhost:5432/db'])(
		'parses %s as postgres',
		(url) => {
			expect(parseDatabaseUrl(url)).toEqual({ dialect: 'postgres', connectionString: url });
		}
	);

	it('rejects unknown schemes', () => {
		expect(() => parseDatabaseUrl('mysql://localhost/db')).toThrow(/Unsupported/);
	});

	it('rejects an empty sqlite path', () => {
		expect(() => parseDatabaseUrl('sqlite://')).toThrow(/missing/);
	});
});
