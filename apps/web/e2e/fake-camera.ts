// Generates a Y4M video showing a QR code, used as Chromium's fake camera
// (--use-file-for-fake-video-capture) so scanning can be tested end to end.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import QRCode from 'qrcode';

export const FAKE_CAMERA_FILE = 'e2e/.fake-camera/qr.y4m';
/** What the fake camera shows: the printed label of a seeded item. */
export const FAKE_CAMERA_SKU = 'RES-0001';
export const FAKE_CAMERA_TEXT = `http://inventory.test/i/${FAKE_CAMERA_SKU}`;

export function writeFakeCamera(path = FAKE_CAMERA_FILE, text = FAKE_CAMERA_TEXT): void {
	const width = 640;
	const height = 480;
	const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
	const modules = qr.modules.size;
	const quiet = 4;
	const scale = Math.floor((height * 0.7) / (modules + 2 * quiet));
	const size = (modules + 2 * quiet) * scale;
	const left = Math.floor((width - size) / 2);
	const top = Math.floor((height - size) / 2);

	// 4:2:0 frame: luma plane, then quarter-size chroma planes (128 = no colour).
	const luma = Buffer.alloc(width * height, 200); // light grey surroundings
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const row = Math.floor(y / scale) - quiet;
			const col = Math.floor(x / scale) - quiet;
			const dark =
				row >= 0 && col >= 0 && row < modules && col < modules && qr.modules.get(row, col);
			luma[(top + y) * width + left + x] = dark ? 16 : 235;
		}
	}
	const chroma = Buffer.alloc((width / 2) * (height / 2) * 2, 128);
	const frame = Buffer.concat([Buffer.from('FRAME\n'), luma, chroma]);
	const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C420jpeg\n`);

	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, Buffer.concat([header, ...Array.from({ length: 10 }, () => frame)]));
}
