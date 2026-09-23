import { expect, test } from "@playwright/test";

const cases = [
	{
		demo: "user-profile",
		group: "Role",
		options: ["Developer", "Designer", "Manager", "QA", "DevOps"],
		required: true,
	},
	{ demo: "settings-panel", group: "Language", options: ["English", "Spanish", "French", "German", "Japanese"] },
	{ demo: "array-items", group: "Priority", options: ["Low", "Medium", "High", "Critical"] },
	{
		demo: "custom-layout",
		group: "Vessel Type",
		options: ["Container", "Bulk Carrier", "Tanker", "RoRo", "General Cargo"],
	},
	{ demo: "search-filters", group: "File Size", options: ["Any", "< 1 MB", "1-10 MB", "10-100 MB", "> 100 MB"] },
] as const;

for (const { demo, group, options, ...rest } of cases) {
	test(`${demo} native options in direct and playground routes`, async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") errors.push(message.text());
		});
		for (const route of [`?demo=${demo}`, `?mode=playground&demo=${demo}&preset=default`]) {
			await page.goto(route);
			const choices = page.getByRole("group", { name: group }).getByRole("radio");
			await expect(choices).toHaveCount(options.length);
			for (const [index, label] of options.entries()) await expect(choices.nth(index)).toHaveAccessibleName(label);
			if ("required" in rest) await expect(choices.first()).toHaveAttribute("aria-required", "true");
			await choices.first().focus();
			await choices.first().press("ArrowDown");
			await expect(choices.nth(1)).toBeChecked();
			if (demo === "array-items") {
				const preview = page.locator("form[data-formbar-definition]");
				await preview.getByRole("textbox", { name: "Project Name" }).fill("Options test");
				await preview.getByRole("button", { name: "Add Tags" }).click();
				const tag = preview.getByRole("combobox", { name: "Tag" });
				await expect(tag).toHaveValue("option-0");
				await expect(tag.getByRole("option", { name: "Back end" })).toBeDisabled();
				await tag.focus();
				await tag.press("End");
				await expect(tag).not.toHaveValue("option-2");
				await tag.selectOption("option-1");
				await preview.getByRole("button", { name: "Add Team Members" }).click();
				await preview.getByRole("textbox", { name: "Name", exact: true }).fill("Ada");
				await preview.getByRole("combobox", { name: "Role" }).selectOption("option-3");
				await preview.getByRole("button", { name: "Add Team Members" }).click();
				await expect(preview.getByRole("textbox", { name: "Name", exact: true }).nth(1)).toBeFocused();
				await preview.getByRole("button", { name: "Move up, item 2" }).last().click();
				await preview.getByRole("button", { name: "Remove, item 1" }).last().click();
				await preview.getByRole("button", { name: "Add Office Locations" }).click();
				await expect(preview.getByRole("combobox", { name: "Label" })).toBeVisible();
				await preview.getByRole("button", { name: "Submit" }).click();
				await expect(page.getByRole("region", { name: "Last successful submission" }).locator("pre")).toContainText(
					'"tags": [',
				);
			} else if (demo === "search-filters") {
				await page.getByRole("button", { name: "Apply Filters" }).click();
				await expect(page.getByRole("region", { name: "Current form data" }).locator("pre")).toContainText(
					'"fileSize": "< 1 MB"',
				);
			}
			await page.getByRole("button", { name: "Reset", exact: true }).click();
			await expect(choices.nth(1)).not.toBeChecked();
			await expect(page.locator("[data-formbar-diagnostic]")).toHaveCount(0);
		}
		expect(errors).toEqual([]);
	});
}
