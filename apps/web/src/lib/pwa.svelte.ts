import { dev } from '$app/env';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

/** Install prompt and update state for the app chrome (plan §M8). */
export const pwa = $state({
	/** A new version is installed and waiting; reload to use it. */
	updateReady: false,
	/** The browser offered an install prompt (Chromium); `install()` shows it. */
	canInstall: false,
	/** Running as an installed app. */
	standalone: false
});

interface InstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installEvent: InstallPromptEvent | null = null;
let registration: ServiceWorkerRegistration | null = null;

export async function install(): Promise<void> {
	if (!installEvent) return;
	await installEvent.prompt();
	await installEvent.userChoice;
	installEvent = null;
	pwa.canInstall = false;
}

/** Activate the waiting version; the page reloads when it takes over. */
export function applyUpdate(): void {
	registration?.waiting?.postMessage('SKIP_WAITING');
}

/** iOS Safari has no install prompt; the app explains "Share → Add to Home Screen" instead. */
export function isIosSafari(): boolean {
	const ua = navigator.userAgent;
	return /iP(hone|ad|od)/.test(ua) && /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

function watch(reg: ServiceWorkerRegistration) {
	const check = () => {
		if (reg.waiting && navigator.serviceWorker.controller) pwa.updateReady = true;
	};
	check();
	reg.addEventListener('updatefound', () => {
		reg.installing?.addEventListener('statechange', check);
	});
}

/** Register the service worker and listen for install/update events. Call once in the layout. */
export function startPwa(): () => void {
	pwa.standalone =
		matchMedia('(display-mode: standalone)').matches ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true;

	const onPrompt = (e: Event) => {
		e.preventDefault();
		installEvent = e as InstallPromptEvent;
		pwa.canInstall = true;
	};
	const onInstalled = () => {
		installEvent = null;
		pwa.canInstall = false;
	};
	window.addEventListener('beforeinstallprompt', onPrompt);
	window.addEventListener('appinstalled', onInstalled);

	let timer: ReturnType<typeof setInterval> | undefined;
	if ('serviceWorker' in navigator && !dev) {
		let reloading = false;
		navigator.serviceWorker.addEventListener('controllerchange', () => {
			// Only reload for an update the user accepted, not for the very first install.
			if (pwa.updateReady && !reloading) {
				reloading = true;
				location.reload();
			}
		});
		navigator.serviceWorker
			.register('/service-worker.js')
			.then(async (reg) => {
				registration = reg;
				watch(reg);
				await navigator.serviceWorker.ready;
				// Cache the scanner's decoder for offline use (it is loaded on demand otherwise).
				void fetch(wasmUrl).catch(() => {});
				timer = setInterval(() => void reg.update().catch(() => {}), 60 * 60_000);
			})
			.catch(() => {
				// No service worker (e.g. plain HTTP on a LAN address): the app still works online.
			});
	}

	return () => {
		window.removeEventListener('beforeinstallprompt', onPrompt);
		window.removeEventListener('appinstalled', onInstalled);
		clearInterval(timer);
	};
}
