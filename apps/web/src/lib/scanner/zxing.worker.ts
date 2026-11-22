// Decodes camera frames with zxing-wasm off the main thread (fallback when the browser has no
// BarcodeDetector, e.g. iOS Safari and desktop Chrome on Linux/Windows).
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { SCAN_FORMATS } from './formats.ts';
import type { DecodeRequest, DecodeResponse } from './protocol.ts';

// Serve the WASM file from our own origin (the library defaults to a CDN), so scanning works
// offline and on networks without internet access.
prepareZXingModule({
	overrides: {
		locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path)
	}
});

const formats = SCAN_FORMATS.map((f) => f.zxing);

self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
	const { id, image } = event.data;
	try {
		const results = await readBarcodes(image, {
			formats: [...formats],
			tryHarder: true,
			maxNumberOfSymbols: 4
		});
		const response: DecodeResponse = {
			id,
			results: results.filter((r) => r.isValid).map((r) => ({ text: r.text, format: r.format }))
		};
		self.postMessage(response);
	} catch (err) {
		self.postMessage({ id, results: [], error: String(err) } satisfies DecodeResponse);
	}
};
