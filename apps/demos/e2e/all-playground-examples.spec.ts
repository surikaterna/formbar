import { type Page, expect, test } from "@playwright/test";

interface BrowserFailure {
	readonly type: "console" | "page" | "http";
	readonly message: string;
}

function observeFailures(page: Page): BrowserFailure[] {
	const failures: BrowserFailure[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") failures.push({ type: "console", message: message.text() });
	});
	page.on("pageerror", (error) => failures.push({ type: "page", message: error.message }));
	page.on("response", (response) => {
		if (response.status() >= 400) failures.push({ type: "http", message: `${response.status()} ${response.url()}` });
	});
	return failures;
}

async function waitForRuntime(page: Page): Promise<void> {
	await expect(page.getByLabel("Running preview").locator("form")).toBeVisible();
	await expect(page.getByText("Preparation diagnostics", { exact: true })).toBeVisible();
}

async function interactWithFirstControl(page: Page): Promise<void> {
	const preview = page.getByLabel("Running preview");
	const control = preview.locator("input, select, textarea").first();
	if ((await control.count()) === 0) {
		await expect(preview.locator("[data-formbar-diagnostic]").first()).toBeVisible();
		return;
	}
	const dataPanel = page.getByText("Current form data", { exact: true }).locator("..");
	const before = await dataPanel.textContent();
	const tag = await control.evaluate((element) => element.tagName);
	const type = await control.getAttribute("type");
	if (tag === "SELECT") {
		const options = await control.locator("option").count();
		if (options < 2) return;
		await control.selectOption({ index: 1 });
	} else if (type === "checkbox" || type === "radio") await control.check();
	else await control.fill(type === "number" || type === "range" ? "2" : "browser-value");
	await expect(dataPanel).not.toHaveText(before ?? "");
}

test("every registry example deep-links and interacts in the production build", async ({ page }) => {
	const failures = observeFailures(page);
	await page.goto("?mode=playground&demo=basic-contact");
	const demoIds = await page
		.getByLabel("Demo")
		.locator("option")
		.evaluateAll((options) => options.flatMap((option) => option.getAttribute("value") ?? []));
	expect(demoIds).toHaveLength(22);
	for (const demoId of demoIds) {
		await page.goto(`?mode=playground&demo=${encodeURIComponent(demoId)}`);
		const variants = await page
			.getByLabel("Example")
			.locator("option")
			.evaluateAll((options) => (options.length ? options.flatMap((option) => option.getAttribute("value") ?? []) : []))
			.catch(() => [] as string[]);
		for (const variant of variants.length ? variants : [undefined]) {
			const suffix = variant ? `&preset=${encodeURIComponent(variant)}` : "";
			await page.goto(`?mode=playground&demo=${encodeURIComponent(demoId)}${suffix}`);
			await waitForRuntime(page);
			await interactWithFirstControl(page);
		}
	}
	expect(failures).toEqual([]);
});

test("advanced profiles, editor keyboard, malformed recovery, and history remain operational", async ({ page }) => {
	const failures = observeFailures(page);
	await page.goto("?mode=playground&demo=custom-renderers&preset=schema-hints");
	await waitForRuntime(page);
	await page.getByRole("button", { name: /Quality Rating 1/ }).click();
	await expect(page.getByText("Current form data", { exact: true }).locator("..")).toContainText('"qualityRating": 1');

	const schemaEditor = page.getByLabel("Schema — strict JSON");
	await schemaEditor.fill("{");
	await page.getByRole("button", { name: "Apply" }).click();
	await expect(page.getByRole("alert")).toBeVisible();
	await expect(page.getByLabel("Running preview").locator("form")).toBeVisible();
	await schemaEditor.fill('{"type":"object","properties":{"safe":{"type":"string","title":"Safe"}}}');
	await page.getByRole("button", { name: "Apply" }).click();
	await expect(page.getByLabel("Running preview").locator("form")).toBeVisible();

	await page.getByRole("tab", { name: /Schema/ }).press("End");
	await expect(page.getByRole("tab", { name: /Initial Data/ })).toBeFocused();
	await page.getByLabel("Demo").selectOption("custom-layout-types");
	await page.getByLabel("Example").selectOption("vessel-inspection:tabs");
	await waitForRuntime(page);
	await expect(page.locator('[data-extension-node="inspection-panel"]')).toBeVisible();
	await page.goBack();
	await expect(page).toHaveURL(/demo=custom-layout-types/);
	expect(failures).toEqual([]);
});
