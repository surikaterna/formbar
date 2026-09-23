import { type Page, expect, test } from "@playwright/test";

function observeFailures(page: Page): string[] {
	const failures: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") failures.push(message.text());
	});
	page.on("pageerror", (error) => failures.push(error.message));
	page.on("response", (response) => {
		if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
	});
	return failures;
}

async function verifyRoute(page: Page, route: string) {
	await page.goto(route);
	const form = page.locator('form[data-formbar-definition="arbiter-calculated"]');
	await expect(form).toBeVisible();
	const price = form.getByLabel("Unit Price ($)");
	const quantity = form.getByLabel("Quantity");
	await expect(price).toHaveAttribute("type", "number");
	await expect(price).toHaveAttribute("min", "0");
	await expect(price).toHaveAttribute("step", "0.01");
	await expect(form).toHaveAttribute("novalidate", "");
	await price.fill("-1");
	expect(await price.evaluate((element: HTMLInputElement) => element.validity.rangeUnderflow)).toBe(true);
	await price.fill("0.001");
	expect(await price.evaluate((element: HTMLInputElement) => element.validity.stepMismatch)).toBe(true);
	await price.fill("25.01");
	await price.press("ArrowUp");
	await expect(price).toHaveValue("25.02");
	await price.press("ArrowDown");
	await expect(price).toHaveValue("25.01");
	await expect(form.getByText("$25.01", { exact: true }).first()).toBeVisible();
	await quantity.fill("9");
	await expect(form.getByText("$225.09", { exact: true }).first()).toBeVisible();
	await quantity.fill("10");
	await expect(form.getByText("bulk", { exact: true })).toBeVisible();
	await expect(form.getByText("$25.01", { exact: true }).first()).toBeVisible();
	await price.fill("0.29");
	await expect(form.getByText("$2.90", { exact: true })).toBeVisible();
	await expect(form.getByText("$0.29", { exact: true })).toBeVisible();
	await expect(form.getByText("$2.61", { exact: true })).toBeVisible();
	await price.fill("-1");
	await form.evaluate((element) =>
		element.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })),
	);
	const result = page.getByText("Last successful submission", { exact: true }).locator("..");
	await expect(result).toContainText('"unitPrice": -1');
	await expect(result).not.toContainText('"subtotal"');
	await quantity.fill("0");
	await form.evaluate((element) =>
		element.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })),
	);
	await expect(result).toContainText('"unitPrice": -1');
	await expect(result).toContainText('"quantity": 10');
}

test("demo 19 direct and playground preserve native cents without imposing schema price bounds", async ({ page }) => {
	const failures = observeFailures(page);
	for (const route of [
		"?mode=demo&demo=arbiter-calculated",
		"?mode=playground&demo=arbiter-calculated&preset=default",
	]) {
		await verifyRoute(page, route);
	}
	expect(failures).toEqual([]);
});
