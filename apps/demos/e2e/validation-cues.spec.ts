import { type Locator, type Page, expect, test } from "@playwright/test";

function form(page: Page): Locator {
	return page.locator(".schema-demo-form form");
}

function field(page: Page, id: string): Locator {
	return form(page).locator(`[data-formbar-node="${id}"]`);
}

async function requiredCue(control: Locator, label: Locator): Promise<void> {
	await expect(control).toHaveAttribute("aria-required", "true");
	const cue = await label.evaluate((element) => getComputedStyle(element, "::after").content);
	expect(cue).toBe('" (required)"');
}

async function invalidCue(control: Locator): Promise<void> {
	await expect(control).toHaveAttribute("aria-invalid", "true");
	const error = await control.getAttribute("aria-errormessage");
	expect(error).toBeTruthy();
	const message = control.locator(`xpath=following-sibling::ul[@id="${error}"]`);
	await expect(message).toBeVisible();
	const describedBy = await control.getAttribute("aria-describedby");
	expect(describedBy?.split(" ")).toContain(error);
	await expect(control).toHaveCSS("border-top-color", "oklch(0.78 0.15 25)");
}

for (const mode of ["demo", "playground"] as const) {
	test(`${mode}: survey real conditional errors and Arbiter presentation-only required cues`, async ({ page }) => {
		await page.goto(`?mode=${mode}&demo=conditional-fields&preset=default`);
		await expect(form(page)).toBeVisible();
		const status = field(page, "f-employment-status");
		await requiredCue(status.locator("input").first(), status.locator("legend"));
		await page.getByLabel("Employed", { exact: true }).check();
		const company = field(page, "f-company-name");
		await expect(company.locator("input")).not.toHaveAttribute("aria-required", "true");
		expect(await company.locator("label").evaluate((element) => getComputedStyle(element, "::after").content)).toBe(
			"none",
		);
		await page.goto(`?mode=${mode}&demo=survey&preset=default`);
		const survey = form(page);
		await expect(survey).toBeVisible();
		await expect(field(page, "f-email")).toHaveCount(0);
		await page.getByLabel("May We Contact You?").check();
		const emailField = field(page, "f-email");
		const email = emailField.locator("input");
		await requiredCue(email, emailField.locator("label"));
		await expect(email).not.toHaveAttribute("aria-invalid", "true");
		await email.fill("bad");
		await email.blur();
		await expect(emailField.locator("ul")).toBeVisible();
		await invalidCue(email);
		await page.getByLabel("May We Contact You?").uncheck();
		await expect(emailField).toHaveCount(0);
		await page.getByLabel("May We Contact You?").check();
		await requiredCue(email, emailField.locator("label"));
		await page.goto(`?mode=${mode}&demo=arbiter-dynamic-sections&preset=default`);
		await expect(form(page)).toBeVisible();
		await page.getByLabel("Coverage Type").selectOption({ label: "auto" });
		const make = field(page, "f-make");
		await requiredCue(make.locator("input"), make.locator("label"));
		await expect(make.locator("ul")).toHaveCount(0);
		await page.getByLabel("Coverage Type").selectOption({ label: "home" });
		await expect(make).toHaveCount(0);
		await page.getByLabel("Coverage Type").selectOption({ label: "auto" });
		await requiredCue(make.locator("input"), make.locator("label"));
	});

	test(`${mode}: committed errors, summary, focus and reset in validation gating`, async ({ page }) => {
		await page.goto(`?mode=${mode}&demo=arbiter-validation-gating&preset=default`);
		await expect(form(page)).toBeVisible();
		const name = field(page, "f-name").locator("input");
		await requiredCue(name, field(page, "f-name").locator("label"));
		await expect(name).not.toHaveAttribute("aria-invalid", "true");
		await name.fill("Ada");
		await name.fill("");
		await invalidCue(name);
		await page.getByLabel("I agree to the Terms of Service").check();
		await form(page).getByRole("button", { name: "Submit" }).click();
		const summary = form(page).locator("[data-formbar-error-summary]");
		await expect(summary).toBeVisible();
		const age = field(page, "f-age").locator("input");
		await expect(summary.locator("a").first()).toHaveAttribute("href", `#${await age.getAttribute("id")}`);
		await expect(age).toBeFocused();
		await expect(age).toHaveAttribute("aria-invalid", "true");
		await name.fill("Ada Lovelace");
		await page.getByLabel("Email", { exact: true }).fill("ada@example.com");
		await page.getByLabel("Age", { exact: true }).fill("36");
		await expect(name).not.toHaveAttribute("aria-invalid", "true");
		await form(page).getByRole("button", { name: "Submit" }).click();
		await expect(form(page).locator("[data-formbar-status]")).toContainText("Form submitted.");
		await form(page).getByRole("button", { name: "Reset" }).click();
		await expect(name).not.toHaveAttribute("aria-invalid", "true");
		await expect(field(page, "f-name").locator("ul")).toHaveCount(0);
	});
}
