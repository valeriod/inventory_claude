import { expect, test } from '@playwright/test';

test('print a label from an item page', async ({ page, context }) => {
	await page.goto('/items/RES-0001');
	await page.getByRole('button', { name: 'Print label' }).click();
	const dialog = page.getByRole('dialog', { name: 'Print label' });
	await dialog.getByLabel('Label stock').selectOption('roll-62x29');
	await expect(dialog).toContainText('1 label on 1 page');
	// PUBLIC_URL is not set for the e2e server.
	await expect(dialog.getByRole('note')).toContainText('PUBLIC_URL');

	// The PDF opens in a new tab. Headless Chromium has no PDF viewer (it downloads instead), so
	// check the request the tab makes.
	const request = context.waitForEvent('request', (r) => r.url().includes('/api/labels?'));
	await dialog.getByRole('button', { name: 'Open PDF' }).click();
	const url = new URL((await request).url());
	expect(url.pathname).toBe('/api/labels');
	expect(url.searchParams.get('skus')).toBe('RES-0001');
	expect(url.searchParams.get('layout')).toBe('roll-62x29');

	const res = await page.request.get(url.pathname + url.search);
	expect(res.headers()['content-type']).toBe('application/pdf');
	expect((await res.body()).subarray(0, 5).toString()).toBe('%PDF-');
});

test('select items in the list and print their labels', async ({ page }) => {
	await page.goto('/items?q=hookup');
	await page.getByRole('checkbox', { name: 'Select all items on this page' }).check();
	const selection = page.getByRole('region', { name: 'Selection' });
	await expect(selection).toContainText('2 selected');
	await selection.getByRole('button', { name: 'Print labels' }).click();
	const dialog = page.getByRole('dialog', { name: 'Print 2 labels' });
	await dialog.getByLabel('Label stock').selectOption('a4-3x8');
	await dialog.getByLabel('Skip positions already used on the sheet').fill('23');
	await expect(dialog).toContainText('2 labels on 2 pages');
});

test('print labels for a location and everything inside it', async ({ page }) => {
	await page.goto('/locations');
	await page
		.getByRole('listitem')
		.filter({ hasText: 'WS-A' })
		.first()
		.getByRole('button', { name: 'Labels' })
		.click();
	await expect(page.getByRole('dialog', { name: /Print \d+ labels/ })).toBeVisible();
});
