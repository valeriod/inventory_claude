import { z } from 'zod';

/** SKUs appear in URLs (/i/<sku>) and QR labels, so they are restricted to URL-safe characters. */
export const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const skuSchema = z
	.string()
	.trim()
	.regex(SKU_PATTERN, 'Use letters, digits, ".", "_" or "-" (max 64 characters)');

export const SKU_PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$/;
export const skuPrefixSchema = z
	.string()
	.trim()
	.regex(SKU_PREFIX_PATTERN, 'Use letters, digits, ".", "_" or "-" (max 16 characters)');

export const SKU_SEQUENCE_DIGITS = 4;

/** formatSku('RES-', 7) → 'RES-0007' */
export function formatSku(prefix: string, sequence: number): string {
	return `${prefix}${String(sequence).padStart(SKU_SEQUENCE_DIGITS, '0')}`;
}

/** Location codes are printed on bin labels as QR codes (/l/<code>), so they follow SKU rules. */
export const locationCodeSchema = z
	.string()
	.trim()
	.regex(SKU_PATTERN, 'Use letters, digits, ".", "_" or "-" (max 64 characters)');
