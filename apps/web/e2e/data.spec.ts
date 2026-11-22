import { expect, test } from '@playwright/test';
import { selectTreeOption, unique, withoutCamera } from './helpers.ts';

test('import items from CSV: check, fix, import', async ({ page }) => {
	const name = unique('Imported resistor');
	await page.goto('/settings');
	await page.getByRole('link', { name: 'Import items (CSV)' }).click();
	await selectTreeOption(page.getByLabel('Category for rows without one'), 'Resistors');

	const bad = `Name,Resistance,Tolerance,Package,On hand\n${name},4k7,9%,0603,25`;
	await page.getByLabel('…or paste CSV').fill(bad);
	await page.getByRole('button', { name: 'Check file' }).click();
	await expect(page.getByTestId('import-summary')).toContainText('1 with errors');
	await expect(page.getByTestId('import-rows')).toContainText('Tolerance');
	await expect(page.getByRole('button', { name: /^Import/ })).toHaveCount(0);

	await page.getByLabel('…or paste CSV').fill(bad.replace('9%', '1%'));
	await page.getByRole('button', { name: 'Check file' }).click();
	await expect(page.getByTestId('import-summary')).toContainText('1 new');
	await page.getByRole('button', { name: 'Import 1 item' }).click();
	await expect(page.getByTestId('import-summary')).toContainText('Imported: 1 new');

	await page.getByTestId('import-rows').getByRole('link').click();
	await expect(page.getByRole('heading', { name })).toBeVisible();
	await expect(page.getByTestId('qty-on-hand')).toHaveText('25 pcs');
});

test('settings offers exports and shows backup and label settings', async ({ page }) => {
	await page.goto('/settings');
	const json = await page
		.getByRole('link', { name: 'Export everything (JSON)' })
		.getAttribute('href');
	const dump = (await (await page.request.get(json!)).json()) as { format: string };
	expect(dump.format).toBe('inventory-dump');
	const csv = await page.getByRole('link', { name: 'Export items (CSV)' }).getAttribute('href');
	expect(await (await page.request.get(csv!)).text()).toContain('SKU,Name,Description,Category');
	await expect(page.getByText('Automatic backups are off')).toBeVisible();
	await expect(page.getByText('Labels link to')).toBeVisible();
});

test('stocktake: scan a bin, count an item, move a stray', async ({ page }) => {
	await withoutCamera(page);
	await page.goto('/scan?mode=stocktake');
	await page.getByLabel('Code').fill('RES-0002');
	await page.getByLabel('Code').press('Enter');
	await expect(page.getByTestId('scan-message')).toContainText('Scan the label of the bin');

	await page.getByLabel('Code').fill('A1');
	await page.getByLabel('Code').press('Enter');
	const panel = page.getByTestId('stocktake');
	await expect(panel).toContainText('Bin A1 · 0 of');

	await page.getByLabel('Code').fill('RES-0003');
	await page.getByLabel('Code').press('Enter');
	const dialog = page.getByRole('dialog', { name: 'Record a count' });
	await dialog.getByLabel('Counted quantity').fill('199');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(panel.locator('[data-sku="RES-0003"]')).toContainText('✓');
	await expect(panel.locator('[data-sku="RES-0003"]')).toContainText('199 pcs');
	await expect(panel).toContainText('Bin A1 · 1 of');

	// A part from another bin found here
	const stray = unique('Stray');
	const categories = (await (await page.request.get('/api/categories')).json()) as {
		id: number;
		name: string;
	}[];
	const tools = categories.find((c) => c.name === 'Tools')!;
	const created = await page.request.post('/api/items', {
		data: { categoryId: tools.id, name: stray, qtyOnHand: 2 }
	});
	expect(created.status()).toBe(201);
	const { sku } = (await created.json()) as { sku: string };
	await page.getByLabel('Code').fill(sku);
	await page.getByLabel('Code').press('Enter');
	await dialog.getByLabel('Counted quantity').fill('2');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await panel.getByRole('button', { name: 'Move to A1' }).click();
	await expect(panel.locator(`[data-sku="${sku}"]`)).toContainText('✓');
});
