import { expect, test } from '@playwright/test';
import { navTo, selectTreeOption } from './helpers.ts';

test('dashboard shows counts and low stock', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('link', { name: /Low stock/ })).toBeVisible();
	const lowStock = page
		.getByRole('region', { name: 'Low stock' })
		.or(page.locator('section', { hasText: 'Low stock' }));
	await expect(lowStock.getByRole('link', { name: 'Hookup wire 22AWG black' })).toBeVisible();
	await expect(lowStock).toContainText('4.2 m available');
});

test('search, category and attribute filters', async ({ page }) => {
	await page.goto('/');
	await navTo(page, 'Items');
	await expect(page.getByRole('heading', { name: 'Items' })).toBeVisible();

	const rows = page.locator('tbody tr');
	await expect(rows.first()).toBeVisible();
	// Other tests add items, so compare with the unfiltered count instead of a fixed number.
	const allRows = await rows.count();

	await page.getByRole('searchbox', { name: 'Search' }).fill('hookup');
	await expect(page).toHaveURL(/q=hookup/);
	await expect(rows).toHaveCount(2);

	await page.getByRole('searchbox', { name: 'Search' }).fill('');
	await expect(page).not.toHaveURL(/q=/);
	await selectTreeOption(page.getByLabel('Category'), 'Wire');
	await expect(page).toHaveURL(/category=\d+/);
	await expect(rows).toHaveCount(3);

	await page.getByLabel('Colour').selectOption('black');
	await expect(page).toHaveURL(/attr\.color=black/);
	await expect(rows).toHaveCount(2);

	await page.getByLabel('Gauge (AWG)', { exact: true }).fill('20');
	await page.getByLabel('Gauge (AWG)', { exact: true }).press('Enter');
	await expect(rows).toHaveCount(1);
	await expect(rows.first()).toContainText('Hookup wire 22AWG black');

	await page.getByRole('link', { name: 'Clear filters' }).click();
	await expect(rows).toHaveCount(allRows);
});

test('QR short links resolve', async ({ page }) => {
	await page.goto('/i/IC-0001');
	await expect(page).toHaveURL(/\/items\/IC-0001$/);
	await expect(page.getByRole('heading', { name: 'LM317 adjustable regulator' })).toBeVisible();

	await page.goto('/l/WS-WR');
	await expect(page).toHaveURL(/\/items\?location=\d+/);
	await expect(page.locator('tbody tr')).toHaveCount(3);
});
