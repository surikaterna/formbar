import { type Locator, type Page, expect, test } from "@playwright/test";

function form(page: Page): Locator {
	return page.locator(".schema-demo-form form");
}

function field(page: Page, id: string): Locator {
	return form(page).locator(`[data-formbar-node="${id}"]`);
}

function submit(page: Page): Locator {
	return page.locator(".schema-demo-form").getByRole("button", { name: "Submit" });
}

async function textContrast(locator: Locator): Promise<number> {
	return locator.evaluate((element) => {
		const context = document.createElement("canvas").getContext("2d");
		if (!context) throw new Error("Canvas color conversion unavailable");
		const channels = (color: string) => {
			context.clearRect(0, 0, 1, 1);
			context.fillStyle = color;
			context.fillRect(0, 0, 1, 1);
			return [...context.getImageData(0, 0, 1, 1).data];
		};
		let background = [255, 255, 255];
		const ancestors: Element[] = [];
		for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current);
		for (const ancestor of ancestors) {
			const [r, g, b, alpha] = channels(getComputedStyle(ancestor).backgroundColor);
			background = [r, g, b].map((value, index) => (value * alpha + background[index] * (255 - alpha)) / 255);
		}
		const foreground = channels(getComputedStyle(element).color);
		const luminance = (rgb: number[]) => {
			const [r, g, b] = rgb.map((value) => {
				const channel = value / 255;
				return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
			});
			return 0.2126 * r + 0.7152 * g + 0.0722 * b;
		};
		const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
		return (values[0] + 0.05) / (values[1] + 0.05);
	});
}

async function legibleText(locator: Locator): Promise<void> {
	await expect(locator).toBeVisible();
	expect(await textContrast(locator)).toBeGreaterThanOrEqual(4.5);
}

async function requiredCue(control: Locator, label: Locator): Promise<void> {
	await expect(control).toHaveAttribute("aria-required", "true");
	const cue = await label.evaluate((element) => getComputedStyle(element, "::after").content);
	expect(cue).toBe('" (required)"');
}

async function invalidCue(page: Page, control: Locator): Promise<void> {
	await expect(control).toHaveAttribute("aria-invalid", "true");
	const error = await control.getAttribute("aria-errormessage");
	expect(error).toBeTruthy();
	const message = control.locator(`xpath=following-sibling::ul[@id="${error}"]`);
	await legibleText(message.locator("li").first());
	const describedBy = await control.getAttribute("aria-describedby");
	expect(describedBy?.split(" ")).toContain(error);
	await expect(control).toHaveCSS("border-top-color", "oklch(0.78 0.15 25)");
	await control.focus();
	await page.keyboard.press("Tab");
	await page.keyboard.press("Shift+Tab");
	await expect(control).toBeFocused();
	await expect(control).toHaveCSS("outline-style", "solid");
	await expect(control).toHaveCSS("outline-width", "2px");
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
		await invalidCue(page, email);
		await page.getByLabel("Very Satisfied", { exact: true }).check();
		await page.getByLabel("Definitely", { exact: true }).check();
		await submit(page).click();
		await expect(form(page).locator("[data-formbar-error-summary]")).toBeVisible();
		await page.getByLabel("May We Contact You?").uncheck();
		await expect(emailField).toHaveCount(0);
		await page.getByLabel("May We Contact You?").check();
		await requiredCue(email, emailField.locator("label"));
	});

	test(`${mode}: Arbiter cues move between branches but do not gate schema-valid submission`, async ({ page }) => {
		await page.goto(`?mode=${mode}&demo=arbiter-dynamic-sections&preset=default`);
		await expect(form(page)).toBeVisible();
		await page.getByLabel("Coverage Type").selectOption({ label: "auto" });
		const make = field(page, "f-make");
		await requiredCue(make.locator("input"), make.locator("label"));
		await make.locator("input").fill("Retained make");
		await make.locator("input").fill("");
		await expect(make.locator("ul")).toHaveCount(0);
		await submit(page).click();
		await expect(form(page).locator("[data-formbar-status]")).toContainText("Form submitted.");
		await expect(make.locator("input")).not.toHaveAttribute("aria-invalid", "true");
		await make.locator("input").fill("Retained make");
		await page.getByLabel("Coverage Type").selectOption({ label: "home" });
		await expect(make).toHaveCount(0);
		const address = field(page, "f-address");
		await requiredCue(address.locator("input"), address.locator("label"));
		await page.getByLabel("Coverage Type").selectOption({ label: "life" });
		await expect(address).toHaveCount(0);
		const age = field(page, "f-age");
		await requiredCue(age.locator("input"), age.locator("label"));
		await page.getByLabel("Coverage Type").selectOption({ label: "auto" });
		await expect(age).toHaveCount(0);
		await requiredCue(make.locator("input"), make.locator("label"));
		await expect(make.locator("input")).toHaveValue("Retained make");
		await expect(make.locator("label")).toHaveCount(1);
		await expect(form(page).locator('[aria-required="true"]')).toHaveCount(3);
	});

	test(`${mode}: committed errors, summary, focus and reset in validation gating`, async ({ page }) => {
		await page.goto(`?mode=${mode}&demo=arbiter-validation-gating&preset=default`);
		await expect(form(page)).toBeVisible();
		const name = field(page, "f-name").locator("input");
		await requiredCue(name, field(page, "f-name").locator("label"));
		await expect(name).not.toHaveAttribute("aria-invalid", "true");
		await name.fill("Ada");
		await name.fill("");
		await invalidCue(page, name);
		await page.getByLabel("I agree to the Terms of Service").check();
		await submit(page).click();
		const summary = form(page).locator("[data-formbar-error-summary]");
		await expect(summary).toBeVisible();
		await legibleText(summary.locator("p"));
		await legibleText(summary.locator("li").first());
		const age = field(page, "f-age").locator("input");
		await expect(summary.locator("a").first()).toHaveAttribute("href", `#${await age.getAttribute("id")}`);
		await expect(age).toBeFocused();
		await expect(age).toHaveAttribute("aria-invalid", "true");
		await name.fill("Ada Lovelace");
		await page.getByLabel("Email", { exact: true }).fill("ada@example.com");
		await page.getByLabel("Age", { exact: true }).fill("36");
		await expect(name).not.toHaveAttribute("aria-invalid", "true");
		await submit(page).click();
		await expect(form(page).locator("[data-formbar-status]")).toContainText("Form submitted.");
		await form(page).getByRole("button", { name: "Reset" }).click();
		await expect(name).not.toHaveAttribute("aria-invalid", "true");
		await expect(field(page, "f-name").locator("ul")).toHaveCount(0);
	});

	test(`${mode}: hidden retained invalid income blocks submission without a hidden inline issue or focus trap`, async ({
		page,
	}) => {
		await page.goto(`?mode=${mode}&demo=conditional-fields&preset=default`);
		await expect(form(page)).toBeVisible();
		await page.getByLabel("Employed", { exact: true }).check();
		const income = field(page, "f-annual-income-employed").locator("input");
		await income.fill("10");
		await submit(page).click();
		await expect(form(page).locator("[data-formbar-status]")).toContainText("Form submitted.");
		const successful = page.getByText("Last successful submission", { exact: true }).locator("..");
		await expect(successful).toContainText('"annualIncome": 10');
		await income.fill("-1");
		await invalidCue(page, income);
		await page.getByLabel("Student", { exact: true }).check();
		await expect(field(page, "f-annual-income-employed")).toHaveCount(0);
		await expect(form(page).locator('ul[id$="-error"]')).toHaveCount(0);
		await submit(page).click();
		const summary = form(page).locator("[data-formbar-error-summary]");
		await legibleText(summary.locator("p"));
		await legibleText(summary.locator("li").first());
		await expect(summary).toBeFocused();
		await expect(summary.locator("a")).toHaveCount(0);
		await expect(successful).toContainText('"annualIncome": 10');
		await page.getByLabel("Employed", { exact: true }).check();
		await expect(income).toHaveValue("-1");
		await invalidCue(page, income);
	});

	test(`${mode}: survey hidden invalid email still blocks full-data schema submission`, async ({ page }) => {
		await page.goto(`?mode=${mode}&demo=survey&preset=default`);
		await expect(form(page)).toBeVisible();
		await page.getByLabel("Very Satisfied", { exact: true }).check();
		await page.getByLabel("Definitely", { exact: true }).check();
		const contact = page.getByLabel("May We Contact You?");
		await contact.check();
		const emailField = field(page, "f-email");
		const email = emailField.locator("input");
		await requiredCue(email, emailField.locator("label"));
		await email.fill("valid@example.com");
		await submit(page).click();
		await expect(form(page).locator("[data-formbar-status]")).toContainText("Form submitted.");
		const successful = page.getByText("Last successful submission", { exact: true }).locator("..");
		await expect(successful).toContainText('"email": "valid@example.com"');
		await email.fill("not-email");
		await invalidCue(page, email);
		await contact.uncheck();
		await expect(emailField).toHaveCount(0);
		await expect(form(page).locator('ul[id$="-error"]')).toHaveCount(0);
		await submit(page).click();
		const summary = form(page).locator("[data-formbar-error-summary]");
		await legibleText(summary.locator("p"));
		await legibleText(summary.locator("li").first());
		await expect(summary).toBeFocused();
		await expect(summary.locator("a")).toHaveCount(0);
		await expect(successful).toContainText('"email": "valid@example.com"');
		await contact.check();
		await expect(email).toHaveValue("not-email");
		await requiredCue(email, emailField.locator("label"));
		await invalidCue(page, email);
	});
}
