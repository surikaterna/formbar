import { expect, test } from "@playwright/test";

test("schema-only options show presentation separately from stored values", async ({ page }) => {
	await page.goto("?mode=playground&demo=basic-contact&preset=schema-options");
	const choice = page.getByRole("combobox", { name: "role" });
	await expect(choice.getByRole("option", { name: "Team lead" })).toHaveAttribute("value", "option-0");
	await expect(choice.getByRole("option", { name: "Quality assurance" })).toBeDisabled();
	await choice.focus();
	await choice.press("End");
	await expect(choice).not.toHaveValue("option-2");
	await choice.selectOption("option-1");
	await expect(page.getByRole("region", { name: "Current form data" }).locator("pre")).toContainText(
		'"role": "developer"',
	);
	await page.getByRole("button", { name: "Submit" }).click();
	await expect(page.getByRole("region", { name: "Last successful submission" }).locator("pre")).toContainText(
		'"role": "developer"',
	);
	await expect(page.getByRole("region", { name: "Preparation diagnostics" }).locator("pre")).toContainText(
		'"compilation": [',
	);
});

test("edited bare enum ignores conflicting props across keyboard selection and submit", async ({ page }) => {
	await page.goto("?mode=playground&demo=basic-contact&preset=schema-options");
	const editor = page.getByLabel("Schema — strict JSON");
	const schema = JSON.parse(await editor.inputValue());
	schema.properties.role.type = undefined;
	schema.properties.role["x-formbar"].props = { options: ["rogue"] };
	await editor.fill(JSON.stringify(schema));
	await page.getByRole("button", { name: "Apply" }).click();
	const choice = page.getByRole("combobox", { name: "role" });
	await expect(choice.getByRole("option", { name: "Team lead" })).toHaveCount(1);
	await expect(choice.locator("option")).toHaveCount(4);
	await expect(choice).not.toContainText("rogue");
	await choice.focus();
	await choice.press("ArrowDown");
	await expect(choice).toHaveValue("option-1");
	await page.getByRole("button", { name: "Submit" }).click();
	await expect(page.getByRole("region", { name: "Last successful submission" }).locator("pre")).toContainText(
		'"role": "developer"',
	);
	await expect(page.getByRole("region", { name: "Preparation diagnostics" }).locator("pre")).toContainText(
		"schema enum choices are authoritative.",
	);
});
