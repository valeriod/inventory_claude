import { expect, test, type Page } from '@playwright/test';
import { FAKE_CAMERA_SKU } from './fake-camera.ts';
import { unique } from './helpers.ts';

async function createProject(page: Page, name: string): Promise<number> {
	const res = await page.request.post('/api/projects', { data: { name, status: 'active' } });
	expect(res.status()).toBe(201);
	return ((await res.json()) as { id: number }).id;
}

async function reserve(page: Page, projectId: number, sku: string, qty: number) {
	const res = await page.request.post(`/api/projects/${projectId}/reservations`, {
		data: { sku, qty }
	});
	expect(res.status()).toBe(201);
}

test('create a project, reserve, partly pick and release parts', async ({ page }) => {
	const name = unique('Amp');
	await page.goto('/projects');
	await page.getByRole('button', { name: '+ New project' }).click();
	const dialog = page.getByRole('dialog', { name: 'New project' });
	await dialog.getByLabel('Name').fill(name);
	await dialog.getByRole('button', { name: 'Create project' }).click();
	await expect(page.getByRole('heading', { name })).toBeVisible();

	// Add a part by searching for it
	await page.getByLabel('Find an item').fill('hookup wire 22AWG black');
	await page.getByRole('button', { name: /Hookup wire 22AWG black/ }).click();
	const reserveDialog = page.getByRole('dialog', { name: 'Reserve for a project' });
	await reserveDialog.getByLabel('Quantity to reserve').fill('2');
	await reserveDialog.getByRole('button', { name: 'Reserve' }).click();
	const line = page.getByTestId('reserved-line');
	await expect(line).toHaveCount(1);
	await expect(line).toContainText('2 m');

	// Closing the project is refused while parts are reserved
	await page.getByRole('button', { name: 'Edit' }).click();
	const edit = page.getByRole('dialog', { name: 'Edit project' });
	await edit.getByLabel('Status').selectOption('completed');
	await expect(edit).toContainText('Use or release the 1 reserved part first');
	await edit.getByRole('button', { name: 'Save' }).click();
	await expect(edit.getByRole('alert')).toContainText('open reservation');
	await edit.getByRole('button', { name: 'Cancel' }).click();

	// Pick part of it: the rest stays reserved
	await line.getByRole('button', { name: 'Pick' }).click();
	const pick = page.getByRole('dialog', { name: 'Pick for project' });
	await pick.getByLabel('Quantity taken').fill('0.5');
	await pick.getByRole('button', { name: 'Take from stock' }).click();
	await expect(line).toContainText('1.5 m');

	await line.getByRole('button', { name: 'Release' }).click();
	await expect(line).toHaveCount(0);
	await expect(page.locator('section', { hasText: 'Used and released' })).toContainText(
		'Released · 1.5 m'
	);
});

test('reserve from an item page', async ({ page }) => {
	const name = unique('Clock');
	await createProject(page, name);
	await page.goto('/items/CAP-0001');
	await page.getByRole('button', { name: 'Reserve…' }).click();
	const dialog = page.getByRole('dialog', { name: 'Reserve for a project' });
	await dialog.getByLabel('Project').selectOption({ label: name });
	await dialog.getByLabel('Quantity to reserve').fill('3');
	await dialog.getByRole('button', { name: 'Reserve' }).click();
	await expect(dialog).toBeHidden();
	const reservations = page.locator('section', { hasText: 'Reservations' });
	await expect(reservations.getByRole('link', { name })).toBeVisible();
	await reservations.getByRole('link', { name }).click();
	await expect(page.getByTestId('reserved-line')).toContainText('CAP-0001');
});

test('use all reserved parts at once', async ({ page }) => {
	const id = await createProject(page, unique('Kit'));
	await reserve(page, id, 'RES-0002', 2);
	await reserve(page, id, 'CAP-0001', 1);
	await page.goto(`/projects/${id}`);
	await expect(page.getByTestId('reserved-line')).toHaveCount(2);
	await page.getByRole('button', { name: 'Use all' }).click();
	await page
		.getByRole('dialog', { name: 'Use all reserved parts?' })
		.getByRole('button', { name: 'Use all' })
		.click();
	await expect(page.getByTestId('reserved-line')).toHaveCount(0);
	await expect(page.locator('section', { hasText: 'Used and released' })).toContainText(
		'Used · 2 pcs'
	);
});

test('pick parts for a project with the scanner', async ({ page }) => {
	const id = await createProject(page, unique('Pick'));
	await reserve(page, id, FAKE_CAMERA_SKU, 3);
	await page.goto(`/projects/${id}`);
	await page.getByRole('link', { name: 'Pick with scanner' }).click();
	await expect(page.getByTestId('to-pick')).toContainText(FAKE_CAMERA_SKU);

	// The fake camera shows the label of FAKE_CAMERA_SKU
	const dialog = page.getByRole('dialog', { name: 'Pick for project' });
	await expect(dialog).toBeVisible({ timeout: 15_000 });
	await dialog.getByRole('button', { name: 'Take from stock' }).click();
	await expect(page.getByText('Everything reserved has been picked.')).toBeVisible();
	await expect(page.locator('section', { hasText: 'This session' })).toContainText('picked 3 pcs');
});

test('project QR links open the project', async ({ page }) => {
	const name = unique('Synth');
	const id = await createProject(page, name);
	await page.goto(`/p/${id}`);
	await expect(page).toHaveURL(new RegExp(`/projects/${id}$`));
	await expect(page.getByRole('heading', { name })).toBeVisible();

	await page.context().clearPermissions();
	await page.goto('/scan');
	await page.getByLabel('Code').fill(`https://inventory.test/p/${id}`);
	await page.getByLabel('Code').press('Enter');
	await expect(page).toHaveURL(new RegExp(`/projects/${id}$`));
});
