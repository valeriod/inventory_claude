import { expect, test, type Page } from '@playwright/test';
import { navTo } from './helpers.ts';

async function qtyOnHand(page: Page, sku: string): Promise<number> {
	const res = await page.request.get(`/api/items/${sku}`);
	return ((await res.json()) as { qtyOnHand: number }).qtyOnHand;
}

test('the app works offline and sends queued stock changes once it is back', async ({
	page,
	context
}) => {
	const sku = 'RES-0002';
	const before = await qtyOnHand(page, sku);

	// Online: the service worker installs and the offline copy is saved.
	await page.goto('/sync');
	await expect(page.getByTestId('synced-at')).toBeVisible({ timeout: 15_000 });
	await page.waitForFunction(async () => {
		const reg = await navigator.serviceWorker.ready;
		return reg.active !== null && navigator.serviceWorker.controller !== null;
	});

	await context.setOffline(true);
	await page.reload();
	await expect(page.getByTestId('offline-banner')).toBeVisible();

	// Browse and search from the offline copy
	await navTo(page, 'Items');
	await page.getByRole('searchbox', { name: 'Search' }).fill('4.7k');
	await expect(page.getByRole('link', { name: '4.7kΩ 1% 0603' })).toBeVisible();
	await page.getByRole('link', { name: '4.7kΩ 1% 0603' }).click();
	await expect(page.getByTestId('qty-on-hand')).toHaveText(`${before} pcs`);

	// Record a stock change: it is queued and shown right away
	await page.getByRole('button', { name: 'Use' }).click();
	const dialog = page.getByRole('dialog', { name: 'Use stock' });
	await dialog.getByLabel('Quantity used').fill('3');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByTestId('qty-on-hand')).toHaveText(`${before - 3} pcs`);
	await expect(page.getByTestId('outbox-badge')).toHaveText('1 change to send');

	// Scanning a bin code also works offline (typed here)
	await page.goto('/scan');
	await page.getByLabel('Code').fill('A1');
	await page.getByLabel('Code').press('Enter');
	await expect(page).toHaveURL(/\/items\?location=\d+/);
	await expect(page.getByRole('link', { name: /220Ω/ })).toBeVisible();

	// Back online: the change is sent once
	await context.setOffline(false);
	await expect(page.getByTestId('outbox-badge')).toHaveCount(0, { timeout: 40_000 });
	await expect(page.getByTestId('offline-banner')).toHaveCount(0);
	expect(await qtyOnHand(page, sku)).toBe(before - 3);
});

test('the web app manifest and icons are served', async ({ page }) => {
	const res = await page.request.get('/manifest.webmanifest');
	expect(res.headers()['content-type']).toContain('application/manifest+json');
	const manifest = (await res.json()) as { icons: { src: string }[]; display: string };
	expect(manifest.display).toBe('standalone');
	for (const icon of manifest.icons) {
		expect((await page.request.get(icon.src)).ok()).toBe(true);
	}
});
