import type { Report, ReportCell } from '@inventory/shared';

/** Cells that a spreadsheet would run as a formula (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: ReportCell, type: string): string {
	if (value === null) return '';
	let text = typeof value === 'number' ? String(value) : value;
	if (type === 'text' && FORMULA_START.test(text)) text = `'${text}`;
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * RFC 4180 CSV with a UTF-8 byte order mark (so Excel reads "Ω" and "µ" correctly) and CRLF line
 * endings. Quantities are plain numbers in the row's unit, which has its own column.
 */
export function reportToCsv(report: Report): string {
	const lines = [report.columns.map((c) => cell(c.label, 'text')).join(',')];
	for (const row of report.rows) {
		lines.push(report.columns.map((c) => cell(row[c.key] ?? null, c.type)).join(','));
	}
	return `\uFEFF${lines.join('\r\n')}\r\n`;
}
