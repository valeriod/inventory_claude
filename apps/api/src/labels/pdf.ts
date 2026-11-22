import { labelSlot, labelsPerPage, type LabelLayout } from '@inventory/shared';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

export interface Label {
	/** Encoded in the QR code (a URL such as https://host/i/RES-0001). */
	url: string;
	/** Large first line: the SKU or location code. */
	title: string;
	/** Item or location name. */
	name: string;
	/** Small last line, e.g. the location of an item. */
	footer?: string | undefined;
}

export interface RenderOptions {
	layout: LabelLayout;
	/** Number of slots to leave empty at the start of the first page. */
	skip?: number;
	/** Draw label outlines (test prints). */
	outline?: boolean;
	title?: string;
}

const PT_PER_MM = 72 / 25.4;
const mm = (v: number) => v * PT_PER_MM;

/**
 * The built-in PDF fonts only cover Windows-1252. Map common characters in component names
 * that are outside it, and replace anything else that cannot be drawn.
 */
const REPLACEMENTS: Record<string, string> = {
	'\u03a9': 'Ohm', // Ω (NFC also maps the ohm sign U+2126 to this)
	'\u03bc': '\u00b5', // Greek mu → micro sign
	'\u2264': '<=',
	'\u2265': '>=',
	'\u2248': '~',
	'\u2212': '-',
	'\u2192': '->'
};
const WIN_1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

export function toPdfText(text: string): string {
	let out = '';
	for (const ch of text.normalize('NFC')) {
		const mapped = REPLACEMENTS[ch] ?? ch;
		if (mapped !== ch) {
			out += mapped;
			continue;
		}
		const code = ch.codePointAt(0)!;
		const printable = (code >= 0x20 && code < 0x7f) || (code >= 0xa0 && code <= 0xff);
		out += printable || WIN_1252_EXTRA.has(ch) ? ch : '?';
	}
	return out;
}

function drawQr(doc: PDFKit.PDFDocument, text: string, x: number, y: number, size: number) {
	const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
	const count = qr.modules.size;
	// Two modules of quiet zone on every side; the label itself is white around it.
	const module = size / (count + 4);
	const origin = { x: x + 2 * module, y: y + 2 * module };
	for (let row = 0; row < count; row++) {
		// Merge horizontal runs of dark modules into one rectangle: smaller PDFs, no hairline gaps.
		let col = 0;
		while (col < count) {
			if (!qr.modules.get(row, col)) {
				col++;
				continue;
			}
			const start = col;
			while (col < count && qr.modules.get(row, col)) col++;
			doc.rect(origin.x + start * module, origin.y + row * module, (col - start) * module, module);
		}
	}
	doc.fill('#000');
}

/** Largest font size (≤ max) at which `text` fits on one line of `width`. */
function fitFontSize(doc: PDFKit.PDFDocument, text: string, width: number, max: number): number {
	const atMax = doc.fontSize(max).widthOfString(text);
	return atMax <= width ? max : Math.max(4, (max * width) / atMax);
}

function drawLabel(
	doc: PDFKit.PDFDocument,
	label: Label,
	x: number,
	y: number,
	layout: LabelLayout
) {
	const w = mm(layout.labelWidth);
	const h = mm(layout.labelHeight);
	const pad = Math.min(mm(2), h * 0.08);
	const qrSize = Math.min(h - 2 * pad + mm(1), w * 0.45);
	drawQr(doc, label.url, x + pad - mm(0.5), y + (h - qrSize) / 2, qrSize);

	const tx = x + pad + qrSize;
	const tw = w - (tx - x) - pad;
	let ty = y + pad;
	const bottom = y + h - pad;

	const title = toPdfText(label.title);
	doc.font('Helvetica-Bold');
	const titleSize = fitFontSize(doc, title, tw, Math.min(14, h * 0.22));
	doc.fontSize(titleSize).text(title, tx, ty, { width: tw, lineBreak: false });
	ty += titleSize * 1.15;

	const footer = label.footer ? toPdfText(label.footer) : '';
	const smallSize = Math.max(5, Math.min(8, h * 0.13));
	const nameBottom = footer ? bottom - smallSize * 1.2 : bottom;
	const name = toPdfText(label.name);
	if (name && nameBottom - ty >= smallSize) {
		doc
			.font('Helvetica')
			.fontSize(Math.max(5, Math.min(9, h * 0.15)))
			.text(name, tx, ty, { width: tw, height: nameBottom - ty, ellipsis: true, lineGap: -0.5 });
	}
	if (footer) {
		doc
			.font('Helvetica')
			.fontSize(fitFontSize(doc, footer, tw, smallSize))
			.fillColor('#444')
			.text(footer, tx, bottom - smallSize, { width: tw, lineBreak: false })
			.fillColor('#000');
	}
}

/** Render labels into a PDF buffer, filling sheets row by row. */
export async function renderLabelsPdf(labels: Label[], options: RenderOptions): Promise<Buffer> {
	const { layout, skip = 0, outline = false } = options;
	const size: [number, number] = [mm(layout.pageWidth), mm(layout.pageHeight)];
	const doc = new PDFDocument({
		size,
		margin: 0,
		autoFirstPage: false,
		info: { Title: options.title ?? 'Inventory labels', Creator: 'Inventory' }
	});
	const chunks: Buffer[] = [];
	doc.on('data', (chunk: Buffer) => chunks.push(chunk));
	const done = new Promise<Buffer>((resolve, reject) => {
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);
	});

	const perPage = labelsPerPage(layout);
	// Skipping only makes sense on sheets; a roll always starts with a fresh label.
	const offset = perPage > 1 ? skip % perPage : 0;
	labels.forEach((label, i) => {
		const slot = (offset + i) % perPage;
		if (i === 0 || slot === 0) doc.addPage({ size, margin: 0 });
		const { x, y } = labelSlot(layout, slot);
		if (outline) {
			doc
				.save()
				.lineWidth(0.25)
				.strokeColor('#999')
				.rect(mm(x), mm(y), mm(layout.labelWidth), mm(layout.labelHeight))
				.stroke()
				.restore();
		}
		drawLabel(doc, label, mm(x), mm(y), layout);
	});

	doc.end();
	return done;
}
