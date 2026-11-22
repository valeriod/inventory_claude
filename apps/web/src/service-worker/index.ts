// App-shell service worker (plan §6.4): the PWA opens and runs offline. API data is not cached
// here; the app keeps its own offline catalogue in IndexedDB and queues stock changes.
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import { self } from '$app/service-worker';

const CACHE = `shell-${version}`;
/** SPA fallback page written by adapter-static; serves every route offline. */
const SHELL = '/200.html';
const PRECACHE = [
	...immutable.map((f) => `/${f.path.replace(/^\//, '')}`),
	...assets.map((f) => `/${f.path.replace(/^\//, '')}`),
	SHELL
];
const PRECACHED = new Set(PRECACHE);

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
	// No skipWaiting(): a new version waits until the user accepts the update toast.
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key.startsWith('shell-') && key !== CACHE) await caches.delete(key);
			}
			await self.clients.claim();
		})()
	);
});

self.addEventListener('message', (event) => {
	if (event.data === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

	if (request.mode === 'navigate') {
		// Network first so online behaviour is unchanged; the cached shell when offline.
		event.respondWith(
			fetch(request).catch(async () => (await caches.match(SHELL)) ?? Response.error())
		);
		return;
	}
	if (PRECACHED.has(url.pathname)) {
		event.respondWith(caches.match(url.pathname).then((cached) => cached ?? fetch(request)));
		return;
	}
	if (url.pathname.startsWith('/_app/immutable/')) {
		// Hashed build files not in the manifest (e.g. the scanner's WASM): cache on first use.
		event.respondWith(
			(async () => {
				const cached = await caches.match(url.pathname);
				if (cached) return cached;
				const response = await fetch(request);
				if (response.ok) {
					const cache = await caches.open(CACHE);
					await cache.put(url.pathname, response.clone());
				}
				return response;
			})()
		);
	}
});
