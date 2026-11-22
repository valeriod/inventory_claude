import { expect, test } from '@playwright/test';
import { selectTreeOption } from './helpers.ts';

test('inventory report with a category filter and downloads', async ({ page }) => {
	await page.goto('/reports');
	const table = page.getByTestId('report-table');
	await expect(table).toContainText('Hookup wire 22AWG red');
	await selectTreeOption(page.getByLabel('Category'), 'Tools');
	await expect(page).toHaveURL(/category=\d+/);
	await expect(table).toContainText('Wire stripper');
	await expect(table).not.toContainText('Hookup wire');

	const csvHref = await page.getByRole('link', { name: 'Download CSV' }).getAttribute('href');
	const csv = await page.request.get(csvHref!);
	expect(csv.headers()['content-type']).toContain('text/csv');
	expect(await csv.text()).toContain('Wire stripper');
	const pdfHref = await page.getByRole('link', { name: 'Open PDF' }).getAttribute('href');
	const pdf = await page.request.get(pdfHref!);
	expect(pdf.headers()['content-type']).toBe('application/pdf');
});

test('low stock, project and movement reports', async ({ page }) => {
	await page.goto('/reports?report=low-stock');
	await expect(page.getByTestId('report-table')).toContainText('Hookup wire 22AWG black');

	await page.goto('/reports?report=project');
	await expect(page.getByText('Choose a project to see its parts')).toBeVisible();
	await page.getByLabel('Project').selectOption({ label: 'Bench power supply' });
	const table = page.getByTestId('report-table');
	await expect(table).toContainText('470µF 25V electrolytic');
	await expect(table.getByRole('columnheader', { name: 'To buy' })).toBeVisible();

	await page.goto('/reports?report=movements');
	await page.getByLabel('Reason').selectOption('count');
	await expect(page.getByTestId('report-table')).toContainText('Counted');
	await expect(page.getByTestId('report-table')).not.toContainText('Received');
});

test('a project links to its report', async ({ page }) => {
	await page.goto('/projects');
	await page.getByRole('link', { name: /Bench power supply/ }).click();
	await page.getByRole('link', { name: 'Report', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Project: Bench power supply' })).toBeVisible();
});
