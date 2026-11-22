/** Result of POST /api/import/items (CSV import with dry run). */
export interface ImportRowResult {
	/** Line number in the file (the header is line 1). */
	line: number;
	sku: string | null;
	name: string;
	action: 'create' | 'update' | 'unchanged' | 'error';
	errors: string[];
	warnings: string[];
}

export interface ImportResult {
	rows: ImportRowResult[];
	summary: { create: number; update: number; unchanged: number; error: number };
	/** Header columns that match no standard column and no custom field of any category. */
	unknownColumns: string[];
	/** True when the changes were written (commit requested and no row had errors). */
	committed: boolean;
}

/** Upper bound on data rows per import. */
export const MAX_IMPORT_ROWS = 5000;
