import { type Page, expect, test } from "@playwright/test";

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

async function arrayOptions(page: Page) {
	const preview = page.locator("form[data-kalada-v1]");
	await preview.getByRole("textbox", { name: "Project Name" }).fill("Options test");
	await preview.getByRole("button", { name: "Add Tags" }).click();
	const tag = preview.getByRole("combobox", { name: "Tag", exact: true });
	await expect(tag).toHaveValue("0");
	await expect(tag.getByRole("option")).toHaveCount(4);
	await expect(tag.getByRole("option", { name: "(empty tag)" })).toHaveCount(1);
	await expect(tag.getByRole("option", { name: "Back end" })).toBeDisabled();
	await tag.focus();
	await tag.press("End");
	await expect(tag).not.toHaveValue("2");
	await tag.selectOption("1");
	await tag.focus();
	await tag.press("Home");
	await expect(tag).toHaveValue("0");
	await preview.getByRole("button", { name: "Add Team Members" }).click();
	await preview.getByRole("textbox", { name: "Name", exact: true }).fill("Ada");
	const role = preview.getByRole("combobox", { name: "Role", exact: true });
	await expect(role.getByRole("option").first()).toHaveAttribute("value", "-1");
	await role.selectOption("3");
	await preview.getByRole("button", { name: "Add Team Members" }).click();
	await expect(preview.getByRole("textbox", { name: "Name", exact: true }).nth(1)).toBeFocused();
	const members = preview.locator('fieldset[data-formbar-node="team-members"] > ol > li');
	const destination = await members.first().getAttribute("data-kalada-row-key");
	await members
		.last()
		.locator('[data-kalada-action="member-up"] select')
		.selectOption(destination ?? "");
	await members.last().locator('[data-kalada-action="member-up"] button').click();
	await members.first().locator('[data-kalada-action="member-remove"] button').click();
	await preview.getByRole("button", { name: "Add Office Locations" }).click();
	await expect(preview.getByRole("combobox", { name: "Label" })).toBeVisible();
	await expect(preview.getByRole("combobox", { name: "Label" }).getByRole("option").first()).toHaveAttribute(
		"value",
		"",
	);
	await preview.locator('[data-kalada-action="submit"] button').click();
	const result = page.getByRole("region", { name: "Last successful submission" }).locator("pre");
	await expect(result).toContainText('"tags": [');
	expect(JSON.parse(await result.innerText()).tags).toEqual([""]);
}

for (const { demo, group, options, ...rest } of cases) {
	test(`${demo} native options in direct and playground routes`, async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		page.on("console", (message) => {
			if (message.type() === "error") errors.push(message.text());
		});
		for (const route of [`?demo=${demo}`, `?mode=playground&demo=${demo}&preset=default`]) {
			await page.goto(route);
			const choices = page.getByRole("radiogroup", { name: group }).getByRole("radio");
			await expect(choices).toHaveCount(options.length);
			for (const [index, label] of options.entries()) await expect(choices.nth(index)).toHaveAccessibleName(label);
			if ("required" in rest)
				await expect(page.getByRole("radiogroup", { name: group })).not.toHaveAttribute("aria-required", "true");
			await choices.first().focus();
			await choices.first().press("ArrowDown");
			await expect(choices.nth(1)).toBeChecked();
			if (demo === "array-items") {
				await arrayOptions(page);
			} else if (demo === "search-filters") {
				await page.getByRole("button", { name: "Apply Filters" }).click();
				await expect(page.getByRole("button", { name: "Apply Filters" }).locator("..").locator("output")).toContainText(
					"applied",
				);
				await page.getByRole("button", { name: "Submit", exact: true }).click();
				await expect(page.getByRole("region", { name: "Last successful submission" })).toContainText(
					'"fileSize": "< 1 MB"',
				);
			}
			await page.getByRole("button", { name: "Reset", exact: true }).first().click();
			await expect(choices.nth(1)).not.toBeChecked();
			await expect(page.locator("[data-formbar-diagnostic]")).toHaveCount(0);
			if (demo === "array-items") {
				const preview = page.locator("form[data-kalada-v1]");
				await expect(preview.getByRole("combobox", { name: "Tag", exact: true })).toHaveCount(0);
				await preview.getByRole("button", { name: "Add Tags" }).click();
				await expect(preview.getByRole("combobox", { name: "Tag", exact: true })).toHaveValue("0");
			}
		}
		expect(errors).toEqual([]);
	});
}
