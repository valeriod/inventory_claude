import { REPORT_KINDS, type ReportKind } from '@inventory/shared';

export function reportKind(params: { get(name: string): string | null }): ReportKind {
	const kind = params.get('report');
	return REPORT_KINDS.find((k) => k === kind) ?? 'inventory';
}

/** Local midnight of a YYYY-MM-DD date as an ISO timestamp, or undefined if invalid. */
function localMidnight(date: string, addDays = 0): string | undefined {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
	if (!m) return undefined;
	const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + addDays);
	return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/**
 * API query for a report page URL. The page keeps local calendar days (`fromDate`, `toDate`,
 * both inclusive); the API takes ISO timestamps with an exclusive end.
 */
export function toApiQuery(params: { toString(): string }): URLSearchParams {
	const query = new URLSearchParams(params.toString());
	const fromDate = query.get('fromDate');
	const toDate = query.get('toDate');
	query.delete('fromDate');
	query.delete('toDate');
	const from = fromDate ? localMidnight(fromDate) : undefined;
	const to = toDate ? localMidnight(toDate, 1) : undefined;
	if (from) query.set('from', from);
	if (to) query.set('to', to);
	return query;
}
