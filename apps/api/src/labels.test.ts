import { describe, expect, it } from 'vitest';
import { toPdfText } from './labels/pdf.ts';
import { json, useApi } from './test-helpers.ts';

describe('GET /api/labels', () => {
	const api = useApi({ seed: true });

	it('renders a PDF for items and locations', async () => {
		const res = await api().send('GET', '/api/labels?skus=RES-0001,CAP-0001&locations=A1');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('application/pdf');
		const pdf = Buffer.from(await res.arrayBuffer());
		expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
		expect(pdf.toString('latin1')).toMatch(/\/Count 1\b/);
	});

	it('starts a new page when a sheet is full, honouring skip', async () => {
		const res = await api().send('GET', '/api/labels?skus=RES-0001,CAP-0001&layout=a4-3x8&skip=23');
		expect(res.status).toBe(200);
		const pdf = Buffer.from(await res.arrayBuffer()).toString('latin1');
		expect(pdf).toMatch(/\/Count 2\b/);
	});

	it('puts one label per page on rolls', async () => {
		const res = await api().send(
			'GET',
			'/api/labels?skus=RES-0001,CAP-0001,IC-0001&layout=roll-62x29&skip=5'
		);
		const pdf = Buffer.from(await res.arrayBuffer()).toString('latin1');
		expect(pdf).toMatch(/\/Count 3\b/);
	});

	it('reports unknown codes', async () => {
		const res = await api().send('GET', '/api/labels?skus=RES-0001,NOPE-1&locations=ZZ');
		expect(res.status).toBe(404);
		const body = await json<{ error: { message: string } }>(res);
		expect(body.error.message).toContain('NOPE-1, ZZ');
	});

	it('validates the query', async () => {
		expect((await api().send('GET', '/api/labels')).status).toBe(400);
		expect((await api().send('GET', '/api/labels?skus=A&layout=x')).status).toBe(400);
	});

	it('reports the base URL used in QR codes', async () => {
		const res = await api().send('GET', 'http://inv.local:3000/api/labels/info');
		expect(await res.json()).toEqual({ baseUrl: 'http://inv.local:3000', configured: false });
	});
});

describe('toPdfText', () => {
	it('maps characters the built-in fonts cannot draw', () => {
		expect(toPdfText('220Ω 5% 4.7μF ±10% ≥ 3')).toBe('220Ohm 5% 4.7µF ±10% >= 3');
		expect(toPdfText('Ω ohm sign')).toBe('Ohm ohm sign');
		expect(toPdfText('漢字 – “quotes”')).toBe('?? – “quotes”');
	});
});
