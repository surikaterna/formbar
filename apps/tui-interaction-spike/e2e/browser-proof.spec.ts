import { type Page, expect, test } from "@playwright/test";

function monitorErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(`console: ${message.text()}`);
	});
	page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
	page.on("requestfailed", (request) => errors.push(`network: ${request.url()} ${request.failure()?.errorText}`));
	return errors;
}

async function snapshot(page: Page) {
	return page.evaluate(() => window.__formbarTuiSpike.snapshot());
}

async function press(page: Page, key: string, count = 1): Promise<void> {
	for (let index = 0; index < count; index++) await page.keyboard.press(key);
}

async function openNameDraft(page: Page): Promise<void> {
	await page.getByRole("textbox", { name: "Terminal input" }).click();
	for (let attempt = 0; attempt < 3; attempt++) {
		if ((await snapshot(page)).output.includes("Commit edit")) return;
		await press(page, "Enter");
		await page.waitForTimeout(100);
	}
	await expect.poll(async () => (await snapshot(page)).output).toContain("Commit edit");
}

test("shares committed values and isolates terminal drafts", async ({ page }) => {
	const errors = monitorErrors(page);
	await page.goto("");
	await page.getByLabel("Name").fill("Web value");
	const identity = (await snapshot(page)).formIdentity;
	await page.getByRole("button", { name: "TUI" }).click();
	await expect.poll(async () => (await snapshot(page)).output).toContain("Web value");

	await openNameDraft(page);
	await press(page, "Backspace", 9);
	await page.keyboard.insertText("draft");
	expect((await snapshot(page)).finalState.name).toBe("Web value");
	await press(page, "Escape");
	expect((await snapshot(page)).finalState.name).toBe("Web value");
	await expect.poll(async () => (await snapshot(page)).output).not.toContain("Commit edit");

	await openNameDraft(page);
	await page.keyboard.insertText(" local draft");
	await page.evaluate(() => window.__formbarTuiSpike.setValue("name", "external"));
	expect((await snapshot(page)).finalState.name).toBe("external");
	await press(page, "Enter");
	await expect.poll(async () => (await snapshot(page)).output).toContain("Value changed externally");
	await press(page, "Escape");
	await openNameDraft(page);
	await press(page, "Backspace", 8);
	await page.keyboard.insertText("TUI value");
	await press(page, "Enter");
	await page.getByRole("button", { name: "Web", exact: true }).click();
	await expect(page.getByLabel("Name")).toHaveValue("TUI value");
	expect((await snapshot(page)).formIdentity).toBe(identity);
	expect(errors).toEqual([]);
});

test("shares submit/reset and cleans terminal resources across toggles", async ({ page }) => {
	const errors = monitorErrors(page);
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:4173" });
	await page.goto("");
	await page.getByLabel("Name").fill("kept");
	const identity = (await snapshot(page)).formIdentity;
	await page.getByRole("button", { name: "Both" }).click();
	await expect.poll(async () => (await snapshot(page)).yogaOutput).toBe(true);
	const strictMounted = await snapshot(page);
	expect(strictMounted.resources.forms.active).toBe(1);
	expect(strictMounted.resources.forms.acquired - strictMounted.resources.forms.disposed).toBe(1);
	expect(strictMounted.resources.terminals.active).toBe(1);
	expect(strictMounted.resources.terminals.acquired - strictMounted.resources.terminals.disposed).toBe(1);
	await openNameDraft(page);
	await page.evaluate(() => navigator.clipboard.writeText("blocked\n\t\u0013paste"));
	await press(page, "Control+V");
	expect((await snapshot(page)).finalState.name).toBe("kept");
	await page.evaluate(() => navigator.clipboard.writeText("日本語"));
	await press(page, "Control+V");
	await press(page, "Enter");
	await expect(page.getByLabel("Name")).toHaveValue("kept日本語");
	await page.evaluate(() => window.__formbarTuiSpike.resize(64, 20));
	await expect.poll(async () => (await snapshot(page)).columns).toBe(64);

	await page.evaluate(() => window.__formbarTuiSpike.setValue("age", 131));
	await page.getByRole("button", { name: "Submit", exact: true }).click();
	await expect(page.getByText("Age exceeds maximum")).toBeVisible();
	expect((await snapshot(page)).submissions).toBe(0);
	await page.evaluate(() => window.__formbarTuiSpike.setValue("age", 37));
	await page.getByRole("button", { name: "Submit", exact: true }).click();
	await expect.poll(async () => (await snapshot(page)).submissions).toBe(1);
	await openNameDraft(page);
	await page.keyboard.insertText(" unsaved");
	await page.getByRole("button", { name: "Reset" }).click();
	await expect(page.getByLabel("Name")).toHaveValue("Ada");
	await expect.poll(async () => (await snapshot(page)).output).toContain("Name *: Ada");
	expect((await snapshot(page)).output).not.toContain("unsaved");
	expect((await snapshot(page)).formIdentity).toBe(identity);

	await page.getByRole("button", { name: "Web", exact: true }).click();
	await expect.poll(async () => (await snapshot(page)).resources.terminals.active).toBe(0);
	await page.getByRole("button", { name: "TUI" }).click();
	await expect.poll(async () => (await snapshot(page)).resources.terminals.active).toBe(1);
	await expect.poll(async () => (await snapshot(page)).output).toContain("Ada");
	expect(errors).toEqual([]);
});

test("keeps the initial route lazy and the Both layout responsive", async ({ page }) => {
	const scripts: string[] = [];
	page.on("response", (response) => {
		if (response.request().resourceType() === "script") scripts.push(response.url());
	});
	await page.goto("");
	await expect(page.getByRole("heading", { name: "Web renderer" })).toBeVisible();
	expect(scripts.some((url) => url.includes("TuiTerminalPanel"))).toBe(false);
	await page.getByRole("button", { name: "Both" }).click();
	await expect.poll(() => scripts.some((url) => url.includes("TuiTerminalPanel"))).toBe(true);

	await page.setViewportSize({ width: 1200, height: 800 });
	const desktop = await page.locator(".renderer-grid").evaluate((node) => getComputedStyle(node).gridTemplateColumns);
	expect(desktop.split(" ")).toHaveLength(2);
	await page.setViewportSize({ width: 390, height: 800 });
	const mobile = await page.locator(".renderer-grid").evaluate((node) => getComputedStyle(node).gridTemplateColumns);
	expect(mobile.split(" ")).toHaveLength(1);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("contains a rejected lazy terminal chunk without blanking the playground", async ({ page }) => {
	await page.route(/TuiTerminalPanel-.*\.js/, (route) => route.abort("failed"));
	await page.goto("");
	await page.getByLabel("Name").fill("still available");
	await page.getByRole("button", { name: "Both" }).click();
	await expect(page.getByRole("alert")).toContainText("terminal renderer could not start");
	await expect(page.getByRole("heading", { name: "Terminal renderer" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Web renderer" })).toBeVisible();
	await expect(page.getByLabel("Name")).toHaveValue("still available");
	await expect(page.getByRole("button", { name: "Submit", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Switch to Web renderer" }).click();
	await expect(page.getByRole("heading", { name: "Web renderer" })).toBeVisible();
});

test("rolls back late terminal acquisition failure and permits a clean remount", async ({ page }) => {
	await page.goto("");
	await page.evaluate(() => {
		const browserWindow = window as typeof window & { __originalResizeObserver?: typeof ResizeObserver };
		browserWindow.__originalResizeObserver = ResizeObserver;
		window.ResizeObserver = class {
			constructor() {
				throw new Error("injected ResizeObserver acquisition failure");
			}
		} as unknown as typeof ResizeObserver;
	});
	await page.getByRole("button", { name: "Both" }).click();
	await expect(page.getByRole("alert")).toContainText("terminal renderer could not start");
	await expect(page.getByRole("heading", { name: "Web renderer" })).toBeVisible();
	expect((await snapshot(page)).resources.terminals.active).toBe(0);
	expect((await snapshot(page)).textListeners).toBe(0);
	await page.getByRole("button", { name: "Switch to Web renderer" }).click();
	await page.evaluate(() => {
		const browserWindow = window as typeof window & { __originalResizeObserver?: typeof ResizeObserver };
		if (browserWindow.__originalResizeObserver) window.ResizeObserver = browserWindow.__originalResizeObserver;
	});
	await page.getByRole("button", { name: "TUI" }).click();
	await expect.poll(async () => (await snapshot(page)).resources.terminals.active).toBe(1);
	await expect.poll(async () => (await snapshot(page)).yogaOutput).toBe(true);
});
