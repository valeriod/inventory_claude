/** Error body returned by every API endpoint. */
export interface ApiErrorBody {
	error: {
		code:
			| 'bad_request'
			| 'validation'
			| 'not_found'
			| 'conflict'
			| 'field_change_conflict'
			| 'insufficient_stock'
			| 'invalid_operation'
			| 'internal';
		message: string;
		/** Validation issues, field violations, or stock details depending on `code`. */
		details?: unknown;
	};
}
