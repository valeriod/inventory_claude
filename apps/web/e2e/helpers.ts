import { expect, type Locator, type Page } from '@playwright/test';

export const PASSWORD = 'e2e-password';

/** Select an option of an indented tree <select> by its visible name. */
export async function selectTreeOption(select: Locator, name: string): Promise<void> {
	const clean = (text: string) => text.replace(/\u00a0/g, '').trim();
	let index = -1;
	// Poll: the select may be re-rendered while the page finishes navigating.
	await expect
		.poll(
			async () => {
				const options = await select.locator('option').allTextContents();
				index = options.findIndex((o) => clean(o) === name);
				return index;
			},
			{ message: `option "${name}"` }
		)
		.toBeGreaterThanOrEqual(0);
	await select.selectOption({ index });
}

/** Unique suffix so repeated runs (desktop + mobile) do not collide. */
export function unique(prefix: string): string {
	return `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

/** Navigate via the main navigation (top bar on desktop, bottom bar on mobile). */
export async function navTo(page: Page, label: string): Promise<void> {
	await page
		.getByRole('navigation', { name: 'Main' })
		.filter({ visible: true })
		.getByRole('link', { name: label })
		.click();
}
