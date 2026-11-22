/**
 * Barcode formats we scan (plan §5): our QR labels, manufacturer retail barcodes (EAN/UPC),
 * Code 128/39 on parts and bins, and Data Matrix on distributor bags.
 */
export const SCAN_FORMATS = [
	{ native: 'qr_code', zxing: 'QRCode', label: 'QR' },
	{ native: 'data_matrix', zxing: 'DataMatrix', label: 'Data Matrix' },
	{ native: 'ean_13', zxing: 'EAN13', label: 'EAN-13' },
	{ native: 'ean_8', zxing: 'EAN8', label: 'EAN-8' },
	{ native: 'upc_a', zxing: 'UPCA', label: 'UPC-A' },
	{ native: 'upc_e', zxing: 'UPCE', label: 'UPC-E' },
	{ native: 'code_128', zxing: 'Code128', label: 'Code 128' },
	{ native: 'code_39', zxing: 'Code39', label: 'Code 39' }
] as const;

export type ZxingFormat = (typeof SCAN_FORMATS)[number]['zxing'];

/** Human-readable name for a format reported by either engine. */
export function formatLabel(format: string): string {
	const f = SCAN_FORMATS.find((x) => x.native === format || x.zxing === format);
	return f?.label ?? format;
}

/**
 * Text as scanned. Data Matrix/Code 128 can carry GS1/ECIA control characters (GS, RS, EOT)
 * inside; keep them for parsing but trim surrounding whitespace.
 */
export function normalizeScan(text: string): string {
	return text.trim();
}
