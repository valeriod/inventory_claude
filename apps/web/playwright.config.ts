import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { FAKE_CAMERA_FILE } from './e2e/fake-camera.ts';

const PORT = 4173;
const CI = Boolean(process.env.CI);
const storageState = 'e2e/.auth/state.json';

/**
 * End-to-end tests against the production build (API serving the PWA) with demo data and
 * password protection enabled. Run `pnpm build` first.
 */
export default defineConfig({
	testDir: 'e2e',
	// Tests share one seeded database; run them in order.
	workers: 1,
	retries: CI ? 1 : 0,
	reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
	// Writes the fake camera video (a QR label) before the browsers start.
	globalSetup: './e2e/global-setup.ts',
	use: {
		baseURL: `http://127.0.0.1:${PORT}`,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		permissions: ['camera'],
		launchOptions: {
			args: [
				'--use-fake-ui-for-media-stream',
				'--use-fake-device-for-media-stream',
				`--use-file-for-fake-video-capture=${resolve(FAKE_CAMERA_FILE)}`
			]
		}
	},
	projects: [
		{ name: 'setup', testMatch: /auth\.setup\.ts/ },
		{
			name: 'desktop',
			use: { ...devices['Desktop Chrome'], storageState },
			dependencies: ['setup']
		},
		{
			name: 'mobile',
			use: { ...devices['Pixel 7'], storageState },
			dependencies: ['setup']
		}
	],
	webServer: {
		command: `node e2e/server.mjs ${PORT}`,
		url: `http://127.0.0.1:${PORT}/api/health`,
		reuseExistingServer: !CI,
		timeout: 120_000,
		stdout: 'pipe'
	}
});
