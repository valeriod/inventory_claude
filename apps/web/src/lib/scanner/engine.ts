import { SCAN_FORMATS } from './formats.ts';
import type { DecodeRequest, DecodeResponse } from './protocol.ts';

export interface Detection {
	text: string;
	format: string;
}

export type EngineName = 'native' | 'zxing';

export interface ScanEngine {
	name: EngineName;
	detect(video: HTMLVideoElement): Promise<Detection[]>;
	dispose(): void;
}

/** localStorage key to force an engine (useful for testing the fallback on Android/macOS). */
export const ENGINE_OVERRIDE_KEY = 'inventory.scanner.engine';

interface NativeDetector {
	detect(source: CanvasImageSource): Promise<{ rawValue: string; format: string }[]>;
}
interface NativeDetectorClass {
	new (options: { formats: string[] }): NativeDetector;
	getSupportedFormats(): Promise<string[]>;
}

async function createNativeEngine(): Promise<ScanEngine | null> {
	const Detector = (globalThis as { BarcodeDetector?: NativeDetectorClass }).BarcodeDetector;
	if (!Detector) return null;
	try {
		const supported = new Set(await Detector.getSupportedFormats());
		// Our own labels are QR codes; an engine that cannot read them is no use.
		if (!supported.has('qr_code')) return null;
		const detector = new Detector({
			formats: SCAN_FORMATS.map((f) => f.native).filter((f) => supported.has(f))
		});
		return {
			name: 'native',
			async detect(video) {
				const found = await detector.detect(video);
				return found.map((b) => ({ text: b.rawValue, format: b.format }));
			},
			dispose() {}
		};
	} catch {
		return null;
	}
}

/** Longest side of the frame handed to zxing; larger is slower without reading much more. */
const ZXING_MAX_SIDE = 1024;

function createZxingEngine(): ScanEngine {
	const worker = new Worker(new URL('./zxing.worker.ts', import.meta.url), { type: 'module' });
	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
	let nextId = 1;
	const pending = new Map<number, (r: DecodeResponse) => void>();
	worker.onmessage = (e: MessageEvent<DecodeResponse>) => {
		pending.get(e.data.id)?.(e.data);
		pending.delete(e.data.id);
	};

	return {
		name: 'zxing',
		async detect(video) {
			const { videoWidth: w, videoHeight: h } = video;
			if (!w || !h) return [];
			const scale = Math.min(1, ZXING_MAX_SIDE / Math.max(w, h));
			canvas.width = Math.round(w * scale);
			canvas.height = Math.round(h * scale);
			ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
			const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
			const id = nextId++;
			const response = await new Promise<DecodeResponse>((resolve) => {
				pending.set(id, resolve);
				worker.postMessage({ id, image } satisfies DecodeRequest, [image.data.buffer]);
			});
			return response.results;
		},
		dispose() {
			worker.terminate();
			for (const resolve of pending.values()) resolve({ id: 0, results: [] });
			pending.clear();
		}
	};
}

/** Native BarcodeDetector when available (fast, Android/macOS), else zxing-wasm in a worker. */
export async function createScanEngine(): Promise<ScanEngine> {
	let override: string | null = null;
	try {
		override = localStorage.getItem(ENGINE_OVERRIDE_KEY);
	} catch {
		// Storage can be unavailable (private mode); ignore.
	}
	if (override !== 'zxing') {
		const native = await createNativeEngine();
		if (native) return native;
	}
	return createZxingEngine();
}
