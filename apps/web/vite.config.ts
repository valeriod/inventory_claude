import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type PluginOption } from 'vite';
import mkcert from 'vite-plugin-mkcert';

// `pnpm dev:https` sets DEV_HTTPS=1: serves over HTTPS on the LAN so phone cameras
// (which require a secure context) can be used for barcode scanning during development.
const https = process.env.DEV_HTTPS === '1';
const apiTarget = process.env.API_URL ?? 'http://127.0.0.1:3000';

const plugins: PluginOption[] = [
	tailwindcss(),
	sveltekit({
		compilerOptions: {
			// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
			runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
		},
		// Static SPA (plan §2): the API serves build/ and falls back to 200.html.
		adapter: adapter({ fallback: '200.html', precompress: true })
	})
];
if (https) plugins.push(mkcert());

export default defineConfig({
	plugins,
	server: {
		host: https ? true : 'localhost',
		proxy: {
			'/api': { target: apiTarget, changeOrigin: false }
		}
	}
});
