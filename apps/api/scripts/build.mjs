// Bundles the API (including the TypeScript workspace packages) into dist/server.js.
// Packages listed in package.json "runtimeDependencies" stay external (better-sqlite3 is native,
// pdfkit reads font data files from disk); the Docker image installs them next to dist/.
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
	external: [...pkg.runtimeDependencies, 'pg-native'],
	define: { __APP_VERSION__: JSON.stringify(version) },
	// Allow bundled CommonJS dependencies (e.g. pg) to use require() in ESM output.
	banner: {
		js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);"
	},
	logLevel: 'info'
});
