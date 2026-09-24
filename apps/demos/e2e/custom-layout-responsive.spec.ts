import { type Locator, type Page, expect, test } from "@playwright/test";

const variants = ["sections", "tabs", "accordion"] as const;
const routes = ["demo", "playground"] as const;

async function checkNavigation(page: Page) {
	const disclosure = page.getByRole("button", { name: /Browse demos/ });
	await expect(disclosure).toHaveAttribute("aria-expanded", "false");
	await disclosure.focus();
	await expect(disclosure).toHaveCSS("outline-style", "solid");
	await disclosure.screenshot({ path: "/tmp/opencode/formbar-182-after-demo-navigation-focus-390.png" });
	await disclosure.press("Enter");
	await expect(disclosure).toHaveAttribute("aria-expanded", "true");
	await expect(page.getByRole("navigation", { name: "Demo navigation" }).locator('[aria-current="page"]')).toHaveCount(
		1,
	);
	await disclosure.press("Space");
	await expect(disclosure).toHaveAttribute("aria-expanded", "false");
}

async function checkGeometry(page: Page, form: Locator, route: string, width: number) {
	const panel = form.locator('[data-extension-node="inspection-panel"]');
	await contained(panel, form, width === 390 ? 260 : route === "demo" ? 600 : 450);
	for (const grid of await panel.locator(".demo17-field-grid:visible").all()) await checkGrid(grid, panel, width);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
	if (route === "demo") await contained(form, page.locator("main").first(), width === 390 ? 280 : 600);
}

async function checkGrid(grid: Locator, panel: Locator, width: number) {
	await contained(grid, panel, width === 390 ? 230 : 450);
	const columns = await grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
	expect(columns).toBe(width === 390 ? 1 : 2);
	const fields = grid.locator('[data-formbar-node^="f-"]');
	for (const field of await fields.all()) {
		await contained(field, grid, width === 390 ? 200 : 150);
		await contained(field.locator("label").first(), field);
		const control = field.locator("input, select, textarea").first();
		await contained(control, field, (await control.getAttribute("type")) === "checkbox" ? 10 : 150);
	}
	const rectangles = await fields.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
	for (let index = 0; index < rectangles.length; index++) {
		for (const other of rectangles.slice(index + 1)) {
			const rect = rectangles[index];
			expect(
				rect.right <= other.left + 1 ||
					other.right <= rect.left + 1 ||
					rect.bottom <= other.top + 1 ||
					other.bottom <= rect.top + 1,
			).toBe(true);
		}
	}
}

async function checkTabs(form: Locator, focusPath: string) {
	const tabs = form.getByRole("tab");
	const first = tabs.first();
	const second = tabs.nth(1);
	await expect(first).toHaveAttribute("aria-selected", "true");
	await expect(second).toHaveAttribute("aria-selected", "false");
	await expect(first).toHaveCSS("font-weight", "700");
	await expect(second).toHaveCSS("font-weight", "400");
	const unfocused = await first.evaluate((node) => getComputedStyle(node).boxShadow);
	await first.focus();
	await expect(first).toHaveCSS("outline-style", "solid");
	expect(await first.evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe(unfocused);
	await first.screenshot({ path: focusPath });
	await first.press("ArrowRight");
	await expect(second).toBeFocused();
	await expect(second).toHaveAttribute("aria-selected", "true");
	await expect(form.locator(`#${await second.getAttribute("aria-controls")}`)).toBeVisible();
	await expect(form.locator(`#${await first.getAttribute("aria-controls")}`)).toBeHidden();
	await second.press("End");
	await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
	await tabs.last().press("Home");
	await first.press("ArrowLeft");
	await expect(tabs.last()).toHaveAttribute("aria-selected", "true");
	await first.click();
	await contained(
		form.locator('[role="tabpanel"]:visible'),
		form.locator('[data-extension-node="inspection-panel"]'),
		200,
	);
}

async function checkAccordion(form: Locator, focusPath: string) {
	const headers = form.locator('[data-formbar-node="inspection-accordion"] h3 button');
	await expect(headers.first()).toHaveAttribute("aria-expanded", "true");
	await expect(headers.nth(1)).toHaveAttribute("aria-expanded", "false");
	await expect(headers.first()).toHaveCSS("font-weight", "700");
	await expect(headers.nth(1)).toHaveCSS("font-weight", "400");
	const unfocused = await headers.nth(1).evaluate((node) => getComputedStyle(node).boxShadow);
	await headers.nth(1).focus();
	await expect(headers.nth(1)).toHaveCSS("outline-style", "solid");
	expect(await headers.nth(1).evaluate((node) => getComputedStyle(node).boxShadow)).not.toBe(unfocused);
	await headers.nth(1).screenshot({ path: focusPath });
	await headers.nth(1).press("Enter");
	await expect(headers.nth(1)).toHaveAttribute("aria-expanded", "true");
	const region = form.locator(`#${await headers.nth(1).getAttribute("aria-controls")}`);
	await expect(region).toHaveAttribute("aria-labelledby", (await headers.nth(1).getAttribute("id")) ?? "");
	await contained(region, form.locator('[data-extension-node="inspection-panel"]'), 200);
	await headers.nth(1).press("Space");
	await expect(region).toBeHidden();
	await headers.nth(1).press("ArrowDown");
	await expect(headers.nth(2)).toBeFocused();
	await headers.nth(2).press("ArrowUp");
	await headers.nth(1).press("End");
	await expect(headers.last()).toBeFocused();
	await headers.last().press("Home");
	await expect(headers.first()).toBeFocused();
}

async function contained(child: Locator, parent: Locator, minimum = 0) {
	const a = await child.boundingBox();
	const b = await parent.boundingBox();
	if (!a || !b) throw new Error("Expected visible layout rectangles");
	expect(a.width).toBeGreaterThan(minimum);
	expect(a.x).toBeGreaterThanOrEqual(b.x - 2);
	expect(a.x + a.width).toBeLessThanOrEqual(b.x + b.width + 2);
}

for (const route of ["demo", "playground"] as const) {
	test(`${route}: validation, submission, reset and mode switch`, async ({ page }) => {
		await page.goto(
			`?mode=${route}&demo=custom-layout-types${route === "playground" ? "&preset=vessel-inspection:sections" : ""}`,
		);
		const vessel = page.getByRole("textbox", { name: "Vessel Name" });
		const inspector = page.getByRole("textbox", { name: "Inspector Name" });
		const data = page.getByRole("region", { name: "Current form data" }).locator("pre");
		const result = page.getByRole("region", { name: "Last successful submission" });
		await vessel.fill("Arctic Star");
		await page.getByRole("button", { name: "Submit", exact: true }).click();
		await expect(inspector).toHaveAttribute("aria-invalid", "true");
		await expect(result).toContainText("No successful submission yet.");
		await inspector.fill("Ada Inspector");
		await page.getByRole("button", { name: "Submit", exact: true }).click();
		await expect(result).toContainText('"vesselName": "Arctic Star"');
		await page.getByRole("button", { name: "Reset", exact: true }).click();
		await expect(data).not.toContainText("Arctic Star");
		await expect(result).toContainText("Arctic Star");
		await vessel.fill("Preserved");
		if (route === "demo") {
			await page.getByLabel("Definition mode").selectOption("tabs");
			await expect(vessel).toHaveValue("Preserved");
			await expect(result).toContainText("Arctic Star");
		} else {
			await page.getByLabel("Example").selectOption("vessel-inspection:tabs");
			await expect(page.getByRole("textbox", { name: "Vessel Name" })).toHaveValue("");
			await expect(result).toContainText("No successful submission yet.");
		}
	});
}

for (const route of routes) {
	for (const variant of variants) {
		test(`${route} ${variant}: responsive layout, state and keyboard`, async ({ page }, info) => {
			const width = info.project.name === "chromium-narrow" ? 390 : 1280;
			await page.setViewportSize({ width, height: 900 });
			await page.goto(
				`?mode=${route}&demo=custom-layout-types${route === "playground" ? `&preset=vessel-inspection:${variant}` : ""}`,
			);
			if (route === "demo") await page.getByLabel("Definition mode").selectOption(variant);
			const form = page.locator(`form[data-formbar-definition="demo17-${variant}"]`);
			await expect(form).toBeVisible();
			if (route === "demo" && width === 390) await checkNavigation(page);
			await checkGeometry(page, form, route, width);
			const focusPath = `/tmp/opencode/formbar-182-after-focus-${route}-${variant}-${width}.png`;
			if (variant === "tabs") await checkTabs(form, focusPath);
			if (variant === "accordion") await checkAccordion(form, focusPath);
			await page.screenshot({
				path: `/tmp/opencode/formbar-182-after-${route}-${variant}-${width}.png`,
				fullPage: true,
			});
		});
	}
}
