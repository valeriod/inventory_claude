import { expect, test, type Page } from '@playwright/test';
import { FAKE_CAMERA_SKU } from './fake-camera.ts';
import { withoutCamera } from './helpers.ts';

/** The fake camera (see fake-camera.ts) continuously shows the QR label of FAKE_CAMERA_SKU. */

async function useZxing(page: Page) {
	await page.addInitScript(() => localStorage.setItem('inventory.scanner.engine', 'zxing'));
}

for (const engine of ['default', 'zxing'] as const) {
	test(`look up a QR label with the camera (${engine} engine)`, async ({ page }) => {
		if (engine === 'zxing') await useZxing(page);
		await page.goto('/scan');
		await expect(page).toHaveURL(new RegExp(`/items/${FAKE_CAMERA_SKU}$`), { timeout: 15_000 });
		await expect(page.getByText(FAKE_CAMERA_SKU, { exact: false }).first()).toBeVisible();
	});
}

test('the zxing engine loads its WASM from our own server', async ({ page }) => {
	await useZxing(page);
	const wasm = page.waitForResponse((r) => r.url().endsWith('.wasm'));
	await page.goto('/scan');
	const response = await wasm;
	expect(new URL(response.url()).origin).toBe(new URL(page.url()).origin);
	expect(response.ok()).toBe(true);
	await expect(page.getByTestId('scanner')).toHaveAttribute('data-engine', 'zxing');
});

test('adjust stock by scanning, without rescanning the label in view', async ({ page }) => {
	await page.goto(`/items/${FAKE_CAMERA_SKU}`);
	const before = await page.getByTestId('qty-on-hand').textContent();

	await page.goto('/scan?mode=adjust');
	const dialog = page.getByRole('dialog', { name: 'Adjust stock' });
	await expect(dialog).toBeVisible({ timeout: 15_000 });
	await dialog.getByLabel('Change (negative to subtract)').fill('-2');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(dialog).toBeHidden();

	const session = page.locator('section', { hasText: 'This session' });
	await expect(session).toContainText(FAKE_CAMERA_SKU);
	await expect(session).toContainText('−2 pcs');
	// The label is still in front of the camera: it must not reopen the dialog by itself.
	await page.waitForTimeout(3500);
	await expect(dialog).toBeHidden();

	await page.goto(`/items/${FAKE_CAMERA_SKU}`);
	const after = await page.getByTestId('qty-on-hand').textContent();
	expect(parseInt(after!)).toBe(parseInt(before!) - 2);
});

test.describe('typed or USB-scanner codes', () => {
	// These tests use the text field only.
	test.beforeEach(async ({ page }) => {
		await withoutCamera(page);
	});

	test('receive a known manufacturer barcode', async ({ page }) => {
		await page.goto('/scan?mode=receive');
		await page.getByLabel('Code').fill('0123456789012');
		await page.getByLabel('Code').press('Enter');
		const dialog = page.getByRole('dialog', { name: 'Receive stock' });
		await expect(dialog).toContainText('LM317');
		await dialog.getByLabel('Quantity received').fill('5');
		await dialog.getByRole('button', { name: 'Save' }).click();
		await expect(page.locator('section', { hasText: 'This session' })).toContainText('+5 pcs');
	});

	test('an unknown barcode in receive mode opens a new item with it', async ({ page }) => {
		const code = `4006${Date.now().toString().slice(-9)}`;
		await page.goto('/scan?mode=receive');
		await page.getByLabel('Code').fill(code);
		await page.getByLabel('Code').press('Enter');
		await expect(page).toHaveURL(/\/items\/new\?barcode=/);
		await expect(page.getByLabel('Manufacturer barcode')).toHaveValue(code);
	});

	test('an unknown barcode in lookup mode offers to create an item', async ({ page }) => {
		await page.goto('/scan');
		await page.getByLabel('Code').fill('NOT-A-CODE-123');
		await page.getByLabel('Code').press('Enter');
		await expect(page.getByTestId('scan-message')).toContainText('No item has the code');
		await page.getByRole('link', { name: 'Create an item with this barcode' }).click();
		await expect(page.getByLabel('Manufacturer barcode')).toHaveValue('NOT-A-CODE-123');
	});

	test('a bin code opens the items stored there', async ({ page }) => {
		await page.goto('/scan');
		await page.getByLabel('Code').fill('A1');
		await page.getByLabel('Code').press('Enter');
		await expect(page).toHaveURL(/\/items\?location=\d+/);
		await expect(page.getByRole('link', { name: /220Ω/ })).toBeVisible();
	});
});
