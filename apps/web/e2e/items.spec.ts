import { expect, test } from '@playwright/test';
import { selectTreeOption, unique } from './helpers.ts';

test('create an item with custom fields, use stock and edit it', async ({ page }) => {
	const name = unique('Resistor');
	await page.goto('/items/new');
	await selectTreeOption(page.getByLabel('Category'), 'Resistors');
	await page.getByLabel('Name').fill(name);

	// Required custom field missing → client-side error
	await page.getByRole('button', { name: 'Create item' }).click();
	await expect(page.getByText('Required')).toBeVisible();

	await page.getByLabel('Resistance').fill('4k7');
	await page.getByLabel('Tolerance').selectOption('1%');
	await page.getByLabel('Package').selectOption('0603');
	await page.getByLabel('Manufacturer', { exact: true }).fill('Yageo');
	await page.getByLabel('Initial stock').fill('100');
	await page.getByRole('button', { name: 'Create item' }).click();

	await expect(page).toHaveURL(/\/items\/RES-\d{4}$/);
	await expect(page.getByRole('heading', { name })).toBeVisible();
	await expect(page.getByTestId('qty-on-hand')).toHaveText('100 pcs');
	const details = page.locator('section', { hasText: 'Details' });
	await expect(details).toContainText('4.7 kΩ');
	await expect(details).toContainText('Yageo');

	await page.getByRole('button', { name: 'Use' }).click();
	const dialog = page.getByRole('dialog', { name: 'Use stock' });
	await dialog.getByLabel('Quantity used').fill('10');
	await dialog.getByLabel('Note').fill('prototype');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByTestId('qty-on-hand')).toHaveText('90 pcs');
	await expect(page.locator('section', { hasText: 'History' })).toContainText('prototype');

	await page.getByRole('link', { name: 'Edit' }).click();
	await expect(page.getByLabel('Resistance')).toHaveValue('4.7k');
	await page.getByLabel('Name').fill(`${name} (edited)`);
	await page.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByRole('heading', { name: `${name} (edited)` })).toBeVisible();
});

test('stock in display units for wire', async ({ page }) => {
	await page.goto('/items/WIR-0003');
	const qty = page.getByTestId('qty-on-hand');
	const before = Number((await qty.textContent())!.replace(' m', ''));

	await page.getByRole('button', { name: 'Receive' }).click();
	const dialog = page.getByRole('dialog', { name: 'Receive stock' });
	await dialog.getByLabel('Quantity received').fill('2,5');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(qty).toHaveText(`${before + 2.5} m`);

	await page.getByRole('button', { name: 'Use' }).click();
	const use = page.getByRole('dialog', { name: 'Use stock' });
	await use.getByLabel('Quantity used').fill('100000');
	await use.getByRole('button', { name: 'Save' }).click();
	await expect(use.getByRole('alert')).toContainText('Insufficient stock');
});
