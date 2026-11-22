import { expect, test } from '@playwright/test';
import { unique } from './helpers.ts';

test('create a category with fields, then remove a field with confirmation', async ({ page }) => {
	const name = unique('Fuses');
	await page.goto('/categories/new');
	await page.getByLabel('Name', { exact: true }).fill(name);
	await page.getByLabel('SKU prefix').fill(`F${Date.now().toString(36).slice(-4).toUpperCase()}-`);

	await page.getByRole('button', { name: '+ Add field' }).click();
	const first = page.getByTestId('field-row').nth(0);
	await first.getByLabel('Label').fill('Current rating');
	await expect(first.getByLabel('Key')).toHaveValue('current_rating');
	await first.getByLabel('Type').selectOption('quantity');
	await first.getByLabel('Unit', { exact: true }).fill('A');

	await page.getByRole('button', { name: '+ Add field' }).click();
	const second = page.getByTestId('field-row').nth(1);
	await second.getByLabel('Label').fill('Speed');
	await second.getByLabel('Type').selectOption('enum');
	await second.getByLabel('Options (one per line)').fill('Fast\nSlow');

	await page.getByRole('button', { name: 'Create category' }).click();
	await expect(page.getByRole('heading', { name })).toBeVisible();
	await expect(page.getByTestId('field-row')).toHaveCount(2);

	await page.getByTestId('field-row').nth(1).getByRole('button', { name: 'Remove' }).click();
	await page.getByRole('button', { name: 'Save changes' }).click();
	const confirm = page.getByRole('dialog', { name: 'Remove fields?' });
	await expect(confirm).toContainText('speed');
	await confirm.getByRole('button', { name: 'Remove and save' }).click();
	await expect(page.getByRole('status')).toHaveText('Saved.');
	await expect(page.getByTestId('field-row')).toHaveCount(1);
});

test('field changes that would invalidate items are refused with the affected SKUs', async ({
	page
}) => {
	await page.goto('/categories');
	await page.getByRole('link', { name: 'Wire', exact: true }).click();
	const colour = page.locator('[data-testid="field-row"][data-key="color"]');
	await colour.getByLabel('Type').selectOption('number');
	await page.getByRole('button', { name: 'Save changes' }).click();
	const alert = page.getByRole('alert');
	await expect(alert).toContainText('would invalidate');
	await expect(alert.getByRole('link', { name: 'WIR-0001' })).toBeVisible();
});
