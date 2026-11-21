// Bundles the API (including the TypeScript workspace packages) into dist/server.js.
// better-sqlite3 is a native module and stays external; it is installed at runtime.
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const version = process.env.APP_VERSION ?? pkg.version;

await build({
	entryPoints: ['src/index.ts'],
	outfile: 'dist/server.js',
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node24',
	sourcemap: true,
	external: ['better-sqlite3', 'pg-native'],
	define: { __APP_VERSION__: JSON.stringify(version) },
	// Allow bundled CommonJS dependencies (e.g. pg) to use require() in ESM output.
	banner: {
		js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
	},
	logLevel: 'info'
});
