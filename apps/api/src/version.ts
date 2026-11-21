// Replaced at build time by esbuild (see scripts/build.mjs).
declare const __APP_VERSION__: string | undefined;

export const VERSION: string =
	typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : (process.env.APP_VERSION ?? 'dev');
