import { defineConfig, devices } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
	testDir: "./e2e",
	outputDir: "./dist/playwright-results",
	fullyParallel: false,
	retries: 0,
	reporter: "line",
	use: {
		baseURL: "http://127.0.0.1:4173/formbar/",
		...(executablePath ? { launchOptions: { executablePath } } : {}),
		trace: "retain-on-failure",
	},
	projects: [
		{ name: "chromium-desktop", use: { ...devices["Desktop Chrome"] } },
		{ name: "chromium-narrow", use: { ...devices["Pixel 5"] } },
	],
	webServer: {
		command: "bun run build && bun run preview --host 127.0.0.1 --port 4173",
		url: "http://127.0.0.1:4173/formbar/",
		reuseExistingServer: false,
		timeout: 120_000,
	},
});
