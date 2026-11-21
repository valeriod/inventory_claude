export type DatabaseTarget =
	{ dialect: 'sqlite'; filename: string } | { dialect: 'postgres'; connectionString: string };

/**
 * Parse a DATABASE_URL into a connection target.
 *
 * Supported forms:
 *   sqlite::memory:              in-memory database (tests)
 *   sqlite://./data/inv.db       path relative to the working directory
 *   sqlite:///data/inv.db        absolute path
 *   postgres://user:pw@host/db   (postgresql:// also accepted)
 */
export function parseDatabaseUrl(url: string): DatabaseTarget {
	const trimmed = url.trim();

	if (trimmed.startsWith('postgres://') || trimmed.startsWith('postgresql://')) {
		return { dialect: 'postgres', connectionString: trimmed };
	}

	if (trimmed.startsWith('sqlite:')) {
		let filename = trimmed.slice('sqlite:'.length);
		if (filename.startsWith('//')) filename = filename.slice(2);
		if (filename === '') throw new Error(`DATABASE_URL is missing a SQLite file path: "${url}"`);
		return { dialect: 'sqlite', filename };
	}

	throw new Error(
		`Unsupported DATABASE_URL "${url}": expected sqlite:<path>, sqlite::memory: or postgres://…`
	);
}
