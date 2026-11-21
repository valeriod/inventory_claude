import { connect, createRepositories, migrateToLatest, seedDemoData } from '@inventory/db';
import { loadConfig } from './config.ts';

const config = loadConfig();
const conn = connect(config.databaseUrl);
try {
	await migrateToLatest(conn);
	const seeded = await seedDemoData(createRepositories(conn));
	console.log(seeded ? 'Demo data added' : 'Database is not empty; nothing seeded');
} finally {
	await conn.close();
}
