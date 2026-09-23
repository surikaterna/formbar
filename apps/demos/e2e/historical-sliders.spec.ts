import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";

const cases = [
	{ demo: "user-profile", label: "Age", key: "age", min: 18, max: 120, required: ["First Name", "Last Name", "Email"] },
	{ demo: "settings-panel", label: "Font Size", key: "fontSize", min: 12, max: 24, required: [] },
	{
		demo: "product-entry",
		label: "Quality Rating",
		key: "rating",
		min: 1,
		max: 5,
		required: ["Product Name", "SKU", "Price (USD)"],
	},
	{
		demo: "custom-layout",
		label: "Year Built",
		key: "yearBuilt",
		min: 1950,
		max: 2026,
		required: ["Vessel Name", "IMO Number"],
	},
] as const;

async function fillRequired(preview: Locator, demo: string, required: readonly string[]) {
	for (const name of required) {
		await preview
			.getByLabel(name, { exact: true })
			.fill(name === "Email" ? "ada@example.com" : name === "Price (USD)" ? "10" : "Example");
	}
	if (demo === "user-profile")
		await preview.getByRole("group", { name: "Role" }).getByRole("radio", { name: "Developer" }).check();
	if (demo === "product-entry") await preview.getByRole("combobox", { name: "Category" }).selectOption({ index: 1 });
}

async function exerciseKeyboard(slider: Locator, data: Locator, key: string, min: number, max: number) {
	await slider.focus();
	await expect(slider).toBeFocused();
	await slider.press("ArrowRight");
	await expect(slider).toHaveValue(String(min + 1));
	await expect(data).toContainText(`"${key}": ${min + 1}`);
	await slider.press("End");
	await expect(slider).toHaveValue(String(max));
	await slider.press("Home");
	await expect(slider).toHaveValue(String(min));
	await slider.press("ArrowRight");
	await slider.press("Tab");
	await expect(slider).not.toBeFocused();
}

for (const { demo, label, key, min, max, required } of cases) {
	test(`${demo} bounded slider preserves optional data and keyboard edits`, async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") errors.push(message.text());
		});
		await page.goto(`?mode=playground&demo=${demo}&preset=default`);
		const preview = page.getByLabel("Running preview");
		const slider = preview.getByRole("slider", { name: label });
		const widget = slider.locator('xpath=ancestor::*[@data-widget="demo16.range"]');
		const data = page.getByRole("region", { name: "Current form data" }).locator("pre");
		const result = page.getByRole("region", { name: "Last successful submission" }).locator("pre");
		await expect(slider).toHaveAttribute("min", String(min));
		await expect(slider).toHaveAttribute("max", String(max));
		await expect(slider).toHaveAttribute("step", "1");
		await expect(slider).toHaveValue(String(min));
		await expect(widget.locator("output")).toHaveText(String(min));
		await expect(data).toHaveText("{}");
		await expect(page.getByLabel("Core validation issues and submission status")).toContainText("pristine");
		await expect(slider).toHaveAccessibleName(label);
		if (label === "Font Size" || label === "Quality Rating") {
			await expect(slider).toHaveAttribute("aria-describedby", /.+/);
		}
		await fillRequired(preview, demo, required);
		await preview.getByRole("button", { name: "Submit" }).click();
		await expect(result).not.toContainText(`"${key}"`);
		await exerciseKeyboard(slider, data, key, min, max);
		await preview.getByRole("button", { name: "Submit" }).click();
		await expect(result).toContainText(`"${key}": ${min + 1}`);
		await preview.getByRole("button", { name: "Reset" }).click();
		await expect(slider).toHaveValue(String(min));
		await expect(widget.locator("output")).toHaveText(String(min));
		await expect(data).toHaveText("{}");
		await slider.focus();
		await slider.press("End");
		await expect(data).toContainText(`"${key}": ${max}`);
		await expect(preview.locator("[data-formbar-diagnostic]")).toHaveCount(0);
		expect(errors).toEqual([]);
	});
}
