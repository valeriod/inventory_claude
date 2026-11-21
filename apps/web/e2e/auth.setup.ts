import { expect, test as setup } from '@playwright/test';
import { PASSWORD } from './helpers.ts';

setup('log in', async ({ page }) => {
	await page.goto('/items');
	await expect(page).toHaveURL(/\/login\?next=%2Fitems/);

	await page.getByLabel('Password').fill('wrong');
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page.getByRole('alert')).toContainText('Wrong password');

	await page.getByLabel('Password').fill(PASSWORD);
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page).toHaveURL(/\/items$/);
	await expect(page.getByRole('heading', { name: 'Items' })).toBeVisible();

	await page.context().storageState({ path: 'e2e/.auth/state.json' });
});
