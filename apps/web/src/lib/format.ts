import {
	formatQuantity,
	formatSi,
	type AttributeValue,
	type Category,
	type FieldDef
} from '@inventory/shared';

/** Stock quantity (integer base units) in the category's display unit, e.g. "37.5 m". */
export function formatQty(
	qty: number,
	category: Pick<Category, 'unitKind' | 'displayUnit'> | undefined
) {
	if (!category) return String(qty);
	return formatQuantity(category.unitKind, qty, category.displayUnit);
}

/** Human-readable attribute value for display. */
export function formatAttribute(
	def: FieldDef | undefined,
	value: AttributeValue | undefined
): string {
	if (value === null || value === undefined || value === '') return '—';
	if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
	if (typeof value === 'boolean') return value ? 'Yes' : 'No';
	if (def?.type === 'quantity' && typeof value === 'number') return formatSi(value, def.unit);
	return String(value);
}

export function formatDateTime(iso: string): string {
	return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export const REASON_LABELS: Record<string, string> = {
	receive: 'Received',
	consume: 'Used',
	adjust: 'Adjusted',
	count: 'Counted',
	reserve_consume: 'Used for project'
};
