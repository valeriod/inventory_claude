// Renders static/icons/icon.svg into the PNG icons the web app manifest and iOS need.
// Run after changing the SVG: node scripts/icons.mjs (uses Playwright's Chromium).
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync(new URL('../static/icons/icon.svg', import.meta.url), 'utf8');
const out = (name) => new URL(`../static/icons/${name}`, import.meta.url).pathname;

// [file, size, inset]: maskable icons keep the artwork inside the 80% safe zone.
const targets = [
	['icon-192.png', 192, 0],
	['icon-512.png', 512, 0],
	['icon-maskable-512.png', 512, 0.1],
	['apple-touch-icon.png', 180, 0]
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, inset] of targets) {
	const pad = Math.round(size * inset);
	await page.setViewportSize({ width: size, height: size });
	await page.setContent(
		`<body style="margin:0;background:#1d4ed8"><div style="padding:${pad}px;width:${size - 2 * pad}px;height:${size - 2 * pad}px">${svg.replace('<svg ', `<svg width="${size - 2 * pad}" height="${size - 2 * pad}" `)}</div></body>`
	);
	await page.screenshot({ path: out(file), clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log('icons written');
