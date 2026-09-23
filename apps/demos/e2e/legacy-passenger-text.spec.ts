import { expect, test } from "@playwright/test";

test("demo 10 deep link submits and resets historical DOB and phone text", async ({ page }) => {
	await page.goto("?mode=playground&demo=multi-section-responsive&preset=default");
	const preview = page.getByLabel("Running preview");
	await expect(preview.locator('form[data-formbar-definition="multi-section-responsive"]')).toBeVisible();
	const dob = preview.getByRole("textbox", { name: "Date of Birth" });
	const phone = preview.getByRole("textbox", { name: "Emergency Contact Phone" });
	await expect(dob).toHaveAttribute("type", "text");
	await expect(phone).toHaveAttribute("type", "text");
	await expect(dob).toHaveAttribute("aria-describedby", /.+/);
	const descriptionId = await dob.getAttribute("aria-describedby");
	await expect(preview.locator(`[id="${descriptionId}"]`)).toHaveText("YYYY-MM-DD format");
	await preview.getByRole("textbox", { name: "First Name" }).fill("Ada");
	await preview.getByRole("textbox", { name: "Last Name" }).fill("Lovelace");
	await dob.fill("not-a-date");
	await phone.fill("extension pending");
	await preview.getByRole("button", { name: "Submit" }).click();
	const result = page.getByText("Last successful submission", { exact: true }).locator("..");
	await expect(result).toContainText('"dateOfBirth": "not-a-date"');
	await expect(result).toContainText('"emergencyContactPhone": "extension pending"');
	await expect(preview.locator("[data-formbar-diagnostic]")).toHaveCount(0);
	await preview.getByRole("button", { name: "Reset" }).click();
	await expect(dob).toBeEmpty();
	await expect(phone).toBeEmpty();
});
