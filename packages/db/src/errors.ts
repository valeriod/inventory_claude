/** Base class for errors the repositories raise on purpose (mapped to HTTP codes in the API). */
export class RepositoryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = new.target.name;
	}
}

/** → 404 */
export class NotFoundError extends RepositoryError {
	constructor(
		readonly entity: string,
		readonly id: string | number
	) {
		super(`${entity} ${JSON.stringify(id)} not found`);
	}
}

/** Unique violation, stale version, or the row is still referenced. → 409 */
export class ConflictError extends RepositoryError {}

export interface FieldViolation {
	sku: string;
	key: string;
}

/** A field-definition change would make existing item values invalid. → 409 */
export class FieldChangeConflictError extends ConflictError {
	constructor(readonly violations: FieldViolation[]) {
		const keys = [...new Set(violations.map((v) => v.key))].join('", "');
		const skus = [...new Set(violations.map((v) => v.sku))];
		const sample =
			skus.slice(0, 5).join(', ') + (skus.length > 5 ? `, … (${skus.length} items)` : '');
		super(
			`Changing field "${keys}" would invalidate existing values in: ${sample}. Update those items first.`
		);
	}
}

/** Business-rule violation (bad state transition, invalid input). → 422 */
export class InvalidOperationError extends RepositoryError {}

/** Not enough stock on hand or available for the requested change. → 409 */
export class InsufficientStockError extends RepositoryError {
	constructor(
		readonly sku: string,
		readonly requested: number,
		readonly available: number
	) {
		super(`Insufficient stock for ${sku}: requested ${requested}, available ${available}`);
	}
}
