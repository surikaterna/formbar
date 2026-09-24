import { type Locator, expect, test } from "@playwright/test";

async function ratingSurface(selected: Locator, unselected: Locator) {
	const surface = (button: Locator) =>
		button.evaluate((node) => {
			const style = getComputedStyle(node);
			return { background: style.backgroundColor, foreground: style.color, weight: style.fontWeight };
		});
	const active = await surface(selected);
	const inactive = await surface(unselected);
	expect(active.background).not.toBe(inactive.background);
	expect(active.foreground).not.toBe(inactive.foreground);
	expect(Number(active.weight)).toBeGreaterThan(Number(inactive.weight));
}

async function selectedAppearance(selected: Locator, unselected: Locator, marker: string) {
	await expect(selected).toHaveAttribute("aria-pressed", "true");
	await expect(unselected).toHaveAttribute("aria-pressed", "false");
	await expect(selected.locator('[aria-hidden="true"]')).toContainText(marker);
	const selectedStyle = await selected.evaluate((node) => {
		const style = getComputedStyle(node);
		return [style.backgroundColor, style.color, style.boxShadow, style.fontWeight];
	});
	const unselectedStyle = await unselected.evaluate((node) => {
		const style = getComputedStyle(node);
		return [style.backgroundColor, style.color, style.boxShadow, style.fontWeight];
	});
	expect(selectedStyle).not.toEqual(unselectedStyle);
}

for (const route of [
	"?mode=demo&demo=custom-renderers",
	"?mode=playground&demo=custom-renderers&preset=schema-hints",
	"?mode=playground&demo=custom-renderers&preset=authored-overrides",
]) {
	for (const width of [390, 1280]) {
		test(`rating surface contrasts at ${width}: ${route}`, async ({ page }) => {
			await page.setViewportSize({ width, height: 800 });
			await page.goto(route);
			const form = page.locator("form[data-formbar-definition]");
			await expect(form).toBeVisible();
			const rating = (value: number) => form.locator(`button[aria-label="Quality Rating: ${value}"]`);
			await rating(3).focus();
			await rating(3).press("Space");
			await expect(rating(3)).toHaveAttribute("aria-pressed", "true");
			await expect(rating(4)).toHaveAttribute("aria-pressed", "false");
			await expect(rating(3)).toHaveCSS("outline-style", "solid");
			await expect(rating(3).locator('[aria-hidden="true"]')).toContainText(route.includes("authored") ? "♥" : "★");
			await ratingSurface(rating(3), rating(4));
			await page.getByRole("button", { name: "Reset", exact: true }).click();
			await expect(rating(3)).toHaveAttribute("aria-pressed", "false");
			await rating(1).click();
			await ratingSurface(rating(1), rating(3));
		});
	}
}

for (const route of [
	"?mode=demo&demo=custom-renderers",
	...["schema-hints", "authored-overrides"].map((preset) => `?mode=playground&demo=custom-renderers&preset=${preset}`),
]) {
	test(`selected widgets are visible and bound: ${route}`, async ({ page }) => {
		await page.goto(route);
		const form = page.locator("form[data-formbar-definition]");
		await expect(form).toBeVisible();
		const rating = (value: number) => form.locator(`button[aria-label="Quality Rating: ${value}"]`);
		const color = (value: string) => form.locator(`button[aria-label="Brand Color: ${value}"]`);
		await expect(rating(3)).toHaveAccessibleName(/Quality Rating.*3/);
		await expect(color("#3B82F6")).toHaveAccessibleName(/Brand Color.*#3B82F6/);
		const data = page.getByRole("region", { name: "Current form data" }).locator("pre");
		const result = page.getByRole("region", { name: "Last successful submission" }).locator("pre");
		for (const light of [false, true]) {
			if (light)
				await page.addStyleTag({ content: ":root { --background: white; --foreground: #171717; --ring: #1457a5; }" });
			await rating(3).focus();
			await rating(3).press("Space");
			await expect(rating(3)).toBeFocused();
			await expect(rating(3)).toHaveCSS("outline-style", "solid");
			await selectedAppearance(rating(3), rating(4), route.includes("authored") ? "♥" : "★");
			await color("#3B82F6").click();
			await selectedAppearance(color("#3B82F6"), color("#EF4444"), "✓");
			const swatch = await color("#3B82F6").boundingBox();
			expect(swatch).not.toBeNull();
			expect(swatch?.x ?? -1).toBeGreaterThanOrEqual(4);
			expect((swatch?.x ?? 0) + (swatch?.width ?? 0) + 4).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
			await expect(data).toContainText('"qualityRating": 3');
			await expect(data).toContainText('"brandColor": "#3B82F6"');
			await rating(1).click();
			await color("#EF4444").click();
			await selectedAppearance(rating(1), rating(3), route.includes("authored") ? "♥" : "★");
			await selectedAppearance(color("#EF4444"), color("#3B82F6"), "✓");
			await form.getByRole("textbox", { name: "Product Name" }).fill("Visible choice");
			await form.locator('button[aria-label="Accent Color: #334155"]').click();
			await page.getByRole("button", { name: "Submit", exact: true }).click();
			await expect(result).toContainText('"qualityRating": 1');
			await expect(result).toContainText('"brandColor": "#EF4444"');
			await page.getByRole("button", { name: "Reset", exact: true }).click();
			await expect(rating(1)).toHaveAttribute("aria-pressed", "false");
			await expect(color("#EF4444").locator('[aria-hidden="true"]')).toHaveCount(0);
			await expect(data).toContainText('"qualityRating": 0');
			await expect(result).toContainText('"qualityRating": 1');
		}
		if (route.includes("playground")) {
			await page.getByLabel("Example").selectOption(route.includes("authored") ? "schema-hints" : "authored-overrides");
			await expect(rating(1)).toHaveAttribute("aria-pressed", "false");
			await expect(color("#EF4444").locator('[aria-hidden="true"]')).toHaveCount(0);
		}
	});
}
