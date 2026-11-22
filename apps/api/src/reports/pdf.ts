import type { Report, ReportCell, ReportColumn } from '@inventory/shared';
import PDFDocument from 'pdfkit';
import { toPdfText } from '../labels/pdf.ts';

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 36;
const FONT_SIZE = 8;
const ROW_HEIGHT = 14;
const HEADER_HEIGHT = 16;

function formatCell(
	value: ReportCell,
	column: ReportColumn,
	dates: Intl.DateTimeFormat,
	numbers: Intl.NumberFormat
): string {
	if (value === null || value === '') return '';
	if (column.type === 'number' && typeof value === 'number') return numbers.format(value);
	if (column.type === 'datetime' && typeof value === 'string') return dates.format(new Date(value));
	return toPdfText(String(value));
}

/**
 * A4 table: landscape for wide reports, header row repeated on every page, page numbers in the
 * footer. Long cells are cut with an ellipsis.
 */
export async function renderReportPdf(
	report: Report,
	options: { timeZone?: string | undefined } = {}
): Promise<Buffer> {
	const landscape = report.columns.length > 7;
	const [width, height] = landscape ? [A4[1], A4[0]] : A4;
	const doc = new PDFDocument({
		size: 'A4',
		layout: landscape ? 'landscape' : 'portrait',
		margin: MARGIN,
		bufferPages: true,
		info: { Title: report.title, Creator: 'Inventory' }
	});
	const chunks: Buffer[] = [];
	doc.on('data', (c: Buffer) => chunks.push(c));
	const done = new Promise<Buffer>((resolve, reject) => {
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);
	});

	const dates = new Intl.DateTimeFormat('en-GB', {
		dateStyle: 'medium',
		timeStyle: 'short',
		...(options.timeZone && { timeZone: options.timeZone })
	});
	const numbers = new Intl.NumberFormat('en', { maximumFractionDigits: 3 });

	const tableWidth = width - 2 * MARGIN;
	const totalWeight = report.columns.reduce((sum, c) => sum + (c.width ?? 1), 0);
	const widths = report.columns.map((c) => ((c.width ?? 1) / totalWeight) * tableWidth);
	const bottom = height - MARGIN - 14;

	// Title block
	doc.font('Helvetica-Bold').fontSize(16).text(toPdfText(report.title), MARGIN, MARGIN);
	doc.font('Helvetica').fontSize(9).fillColor('#444');
	const meta = [...report.filters, `Generated ${dates.format(new Date(report.generatedAt))}`];
	doc.text(toPdfText(meta.join(' · ')), { width: tableWidth });
	if (report.summary.length > 0) {
		doc.text(report.summary.map((s) => `${s.label}: ${s.value}`).join('   '));
	}
	if (report.truncated) {
		doc.fillColor('#b45309').text(`Only the first ${report.rows.length} rows are included.`);
	}
	doc.fillColor('#000');
	let y = doc.y + 8;

	const drawHeader = () => {
		doc.rect(MARGIN, y, tableWidth, HEADER_HEIGHT).fill('#e2e8f0').fillColor('#000');
		doc.font('Helvetica-Bold').fontSize(FONT_SIZE);
		let x = MARGIN;
		report.columns.forEach((c, i) => {
			doc.text(toPdfText(c.label), x + 3, y + 4, {
				width: widths[i]! - 6,
				align: c.type === 'number' ? 'right' : 'left',
				lineBreak: false,
				ellipsis: true,
				height: FONT_SIZE + 2
			});
			x += widths[i]!;
		});
		y += HEADER_HEIGHT;
		doc.font('Helvetica');
	};

	drawHeader();
	if (report.rows.length === 0) {
		doc
			.fontSize(9)
			.fillColor('#666')
			.text('No rows.', MARGIN, y + 6)
			.fillColor('#000');
	}
	report.rows.forEach((row, index) => {
		if (y + ROW_HEIGHT > bottom) {
			doc.addPage();
			y = MARGIN;
			drawHeader();
		}
		if (index % 2 === 1)
			doc.rect(MARGIN, y, tableWidth, ROW_HEIGHT).fill('#f8fafc').fillColor('#000');
		doc.fontSize(FONT_SIZE);
		let x = MARGIN;
		report.columns.forEach((c, i) => {
			doc.text(formatCell(row[c.key] ?? null, c, dates, numbers), x + 3, y + 3.5, {
				width: widths[i]! - 6,
				align: c.type === 'number' ? 'right' : 'left',
				lineBreak: false,
				ellipsis: true,
				height: FONT_SIZE + 2
			});
			x += widths[i]!;
		});
		y += ROW_HEIGHT;
	});

	// Page numbers
	const range = doc.bufferedPageRange();
	for (let i = range.start; i < range.start + range.count; i++) {
		doc.switchToPage(i);
		// The footer sits inside the bottom margin; without this pdfkit would start a new page.
		doc.page.margins.bottom = 0;
		doc
			.fontSize(7)
			.fillColor('#666')
			.text(
				`${toPdfText(report.title)} · page ${i + 1} of ${range.count}`,
				MARGIN,
				height - MARGIN,
				{
					width: tableWidth,
					align: 'right',
					lineBreak: false
				}
			);
	}

	doc.end();
	return done;
}
