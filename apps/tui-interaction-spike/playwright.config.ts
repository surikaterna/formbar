import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	outputDir: "/tmp/formbar-playwright-results",
	fullyParallel: false,
	retries: 0,
	workers: 1,
	use: { baseURL: "http://127.0.0.1:4173/formbar/tui/", browserName: "chromium" },
	webServer: {
		command: "bunx vite preview --host 127.0.0.1 --port 4173",
		url: "http://127.0.0.1:4173/formbar/tui/",
		reuseExistingServer: false,
	},
});
