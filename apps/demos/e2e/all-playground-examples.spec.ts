import { type Page, expect, test } from "@playwright/test";

interface ExpectedRoute {
	readonly demoId: string;
	readonly preset: string;
	readonly definitionId: string;
	readonly diagnostic?: string;
}

interface BrowserFailure {
	readonly type: "console" | "page" | "http";
	readonly message: string;
}

const expectedRoutes: readonly ExpectedRoute[] = [
	{ demoId: "basic-contact", preset: "default", definitionId: "schema-json-schema-input-form" },
	{ demoId: "user-profile", preset: "default", definitionId: "user-profile" },
	{ demoId: "nested-address", preset: "default", definitionId: "nested-address" },
	{ demoId: "settings-panel", preset: "default", definitionId: "settings-panel" },
	{ demoId: "product-entry", preset: "default", definitionId: "product-entry" },
	{ demoId: "rich-validation", preset: "default", definitionId: "rich-validation" },
	{ demoId: "conditional-fields", preset: "default", definitionId: "conditional-fields" },
	{ demoId: "array-items", preset: "default", definitionId: "array-items" },
	{ demoId: "custom-layout", preset: "default", definitionId: "custom-layout" },
	{ demoId: "multi-section-responsive", preset: "default", definitionId: "multi-section-responsive" },
	{ demoId: "search-filters", preset: "default", definitionId: "search-filters" },
	{ demoId: "survey", preset: "default", definitionId: "survey" },
	{ demoId: "multi-schema-sources", preset: "minimal", definitionId: "minimal-schema" },
	{ demoId: "multi-schema-sources", preset: "explicit", definitionId: "explicit-schema" },
	{ demoId: "order-entry", preset: "default", definitionId: "order-entry" },
	{ demoId: "kitchen-sink", preset: "default", definitionId: "kitchen-sink" },
	{ demoId: "custom-renderers", preset: "schema-hints", definitionId: "schema-json-schema-input-form" },
	{ demoId: "custom-renderers", preset: "authored-overrides", definitionId: "demo16-authored-overrides" },
	{
		demoId: "custom-renderers",
		preset: "extension-diagnostics",
		definitionId: "demo16-extension-diagnostics",
		diagnostic: "missing-extension",
	},
	{ demoId: "custom-layout-types", preset: "vessel-inspection:sections", definitionId: "demo17-sections" },
	{ demoId: "custom-layout-types", preset: "vessel-inspection:tabs", definitionId: "demo17-tabs" },
	{ demoId: "custom-layout-types", preset: "vessel-inspection:accordion", definitionId: "demo17-accordion" },
	{ demoId: "arbiter-visibility", preset: "default", definitionId: "arbiter-visibility" },
	{ demoId: "arbiter-calculated", preset: "default", definitionId: "arbiter-calculated" },
	{ demoId: "arbiter-validation-gating", preset: "default", definitionId: "arbiter-validation-gating" },
	{ demoId: "arbiter-dynamic-sections", preset: "default", definitionId: "arbiter-dynamic-sections" },
	{ demoId: "schema-compilation", preset: "default", definitionId: "schema-json-schema-input-form" },
	{ demoId: "basic-contact", preset: "schema-options", definitionId: "schema-json-schema-input-form" },
];

const expectedSelectors = [
	["basic-contact", ["default", "schema-options"]],
	["user-profile", ["default"]],
	["nested-address", ["default"]],
	["settings-panel", ["default"]],
	["product-entry", ["default"]],
	["rich-validation", ["default"]],
	["conditional-fields", ["default"]],
	["array-items", ["default"]],
	["custom-layout", ["default"]],
	["multi-section-responsive", ["default"]],
	["search-filters", ["default"]],
	["survey", ["default"]],
	["multi-schema-sources", ["minimal", "explicit"]],
	["order-entry", ["default"]],
	["kitchen-sink", ["default"]],
	["custom-renderers", ["schema-hints", "authored-overrides", "extension-diagnostics"]],
	["custom-layout-types", ["vessel-inspection:sections", "vessel-inspection:tabs", "vessel-inspection:accordion"]],
	["arbiter-visibility", ["default"]],
	["arbiter-calculated", ["default"]],
	["arbiter-validation-gating", ["default"]],
	["arbiter-dynamic-sections", ["default"]],
	["schema-compilation", ["default"]],
] as const;

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

function routeUrl(route: ExpectedRoute): string {
	return `?mode=playground&demo=${encodeURIComponent(route.demoId)}&preset=${encodeURIComponent(route.preset)}`;
}

async function waitForRuntime(page: Page, route: ExpectedRoute): Promise<void> {
	await expect(page.getByLabel("Demo")).toHaveValue(route.demoId);
	const variants = expectedSelectors.find(([demoId]) => demoId === route.demoId)?.[1];
	expect(variants).toBeDefined();
	if ((variants?.length ?? 0) > 1) await expect(page.getByLabel("Example")).toHaveValue(route.preset);
	else await expect(page.getByLabel("Example")).toHaveCount(0);
	await expect(page.locator(`form[data-formbar-definition="${route.definitionId}"]`)).toBeVisible();
	await expect(page.getByText("Preparation diagnostics", { exact: true })).toBeVisible();
}

async function interactWithExpectedMarker(page: Page, route: ExpectedRoute): Promise<void> {
	const preview = page.getByLabel("Running preview");
	if (route.diagnostic) {
		await expect(preview.locator(`[data-formbar-diagnostic="${route.diagnostic}"]`).first()).toBeVisible();
		expect(await preview.locator("input, select, textarea").count()).toBe(0);
		const status = preview.getByLabel("Core validation issues and submission status");
		const result = preview.getByText("Last successful submission", { exact: true }).locator("..");
		await expect(status).toContainText("Status: idle; 0 issue(s); pristine.");
		await expect(result).toContainText("No successful submission yet.");
		await preview.getByRole("button", { name: "Submit", exact: true }).click();
		await expect(status).toContainText("Status: succeeded; 0 issue(s); pristine.");
		await expect(result).toContainText('"missingWidget": ""');
	} else {
		const control = preview.locator("input:not([disabled]), select:not([disabled]), textarea:not([disabled])").first();
		await expect(control).toBeVisible();
		const dataPanel = page.getByText("Current form data", { exact: true }).locator("..");
		const before = await dataPanel.textContent();
		const tag = await control.evaluate((element) => element.tagName);
		const type = await control.getAttribute("type");
		if (tag === "SELECT") {
			const options = await control.locator("option").count();
			expect(options).toBeGreaterThan(1);
			await control.selectOption({ index: route.preset === "schema-options" ? 2 : 1 });
		} else if (type === "checkbox") {
			if (await control.isChecked()) await control.uncheck();
			else await control.check();
		} else if (type === "radio") {
			const alternative = preview.locator('input[type="radio"]:not(:checked)').first();
			await expect(alternative).toBeVisible();
			await alternative.check();
		} else await control.fill(type === "number" || type === "range" ? "2" : "browser-value");
		await expect(dataPanel).not.toHaveText(before ?? "");
	}
}

test("selector cardinality and order match the independent route fixture", async ({ page }) => {
	test.setTimeout(60_000);
	await page.goto(routeUrl(expectedRoutes[0]));
	const demoOptions = await page
		.getByLabel("Demo")
		.locator("option")
		.evaluateAll((options) => options.map((option) => option.getAttribute("value")));
	expect(demoOptions).toEqual(expectedSelectors.map(([demoId]) => demoId));
	for (const [demoId, presets] of expectedSelectors) {
		await page.goto(routeUrl({ demoId, preset: presets[0], definitionId: "selector-check" }));
		const selector = page.getByLabel("Example");
		if (presets.length === 1) await expect(selector).toHaveCount(0);
		else {
			await expect(selector).toHaveCount(1);
			expect(
				await selector
					.locator("option")
					.evaluateAll((options) => options.map((option) => option.getAttribute("value"))),
			).toEqual(presets);
		}
	}
});

test("all 28 independent deep links select and interact with their expected production definition", async ({
	page,
}) => {
	test.setTimeout(60_000);
	const failures = observeFailures(page);
	expect(expectedRoutes).toHaveLength(28);
	for (const route of expectedRoutes) {
		await page.goto(routeUrl(route));
		const current = new URL(page.url());
		expect([current.searchParams.get("demo"), current.searchParams.get("preset")]).toEqual([
			route.demoId,
			route.preset,
		]);
		await waitForRuntime(page, route);
		await interactWithExpectedMarker(page, route);
	}
	expect(failures).toEqual([]);
});

test("invalid schema apply is atomic, recovers, and advanced navigation remains operational", async ({ page }) => {
	const failures = observeFailures(page);
	await page.goto(routeUrl(expectedRoutes[0]));
	await waitForRuntime(page, expectedRoutes[0]);
	await page.getByLabel("Full Name").fill("Last Valid");
	await page.getByLabel("Email").fill("last-valid@example.com");
	await page.getByRole("button", { name: "Submit" }).click();
	const dataPanel = page.getByText("Current form data", { exact: true }).locator("..");
	const resultPanel = page.getByText("Last successful submission", { exact: true }).locator("..");
	await expect(dataPanel).toContainText('"name": "Last Valid"');
	await expect(resultPanel).toContainText('"name": "Last Valid"');

	const form = page.getByLabel("Running preview").locator("form");
	await form.evaluate((element) => element.setAttribute("data-atomic-session", "last-valid"));
	const schemaEditor = page.getByLabel("Schema — strict JSON");
	const validSchema = await schemaEditor.inputValue();
	await schemaEditor.fill('{"type":"object","minProperties":-1}');
	await page.getByRole("button", { name: "Apply" }).click();
	await expect(page.getByRole("alert")).toContainText("Schema is not valid Draft 2020-12");
	await expect(form).toHaveAttribute("data-atomic-session", "last-valid");
	await expect(dataPanel).toContainText('"name": "Last Valid"');
	await expect(resultPanel).toContainText('"name": "Last Valid"');

	await schemaEditor.fill(validSchema);
	await page.getByRole("button", { name: "Apply" }).click();
	await expect(page.getByRole("alert")).toHaveCount(0);
	await expect(page.getByLabel("Running preview").locator("form")).not.toHaveAttribute(
		"data-atomic-session",
		"last-valid",
	);

	await page.getByLabel("Demo").selectOption("custom-renderers");
	await waitForRuntime(page, expectedRoutes[16]);
	await page.getByRole("button", { name: /Quality Rating 1/ }).click();
	await expect(page.getByText("Current form data", { exact: true }).locator("..")).toContainText('"qualityRating": 1');
	await page.getByRole("tab", { name: /Schema/ }).press("End");
	await expect(page.getByRole("tab", { name: /Initial Data/ })).toBeFocused();
	await page.getByLabel("Demo").selectOption("custom-layout-types");
	await page.getByLabel("Example").selectOption("vessel-inspection:tabs");
	await waitForRuntime(page, expectedRoutes[20]);
	await expect(page.locator('[data-extension-node="inspection-panel"]')).toBeVisible();
	await page.goBack();
	await expect(page).toHaveURL(/demo=custom-layout-types/);
	expect(failures).toEqual([]);
});
