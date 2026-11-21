import { connect, migrateToLatest } from '@inventory/db';
import { loadConfig } from './config.ts';

const config = loadConfig();
const conn = connect(config.databaseUrl);
try {
	const results = await migrateToLatest(conn);
	if (results.length === 0) console.log('Database is up to date');
	for (const m of results) console.log(`migration ${m.migrationName}: ${m.status}`);
} finally {
	await conn.close();
}
