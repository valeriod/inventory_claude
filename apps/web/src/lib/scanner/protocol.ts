/** Messages between the scanner engine and the zxing worker. */
export interface DecodeRequest {
	id: number;
	image: ImageData;
}

export interface DecodeResponse {
	id: number;
	results: { text: string; format: string }[];
	error?: string;
}
