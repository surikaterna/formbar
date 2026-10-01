import { type Locator, type Page, expect, test } from "@playwright/test";

const routes = ["demo", "playground"] as const;
const repeater = (page: Page, id: string) => page.locator(`.schema-demo-form fieldset[data-formbar-node="${id}"]`);
const rows = (list: Locator) => list.locator(":scope > ol > li");
const action = (row: Locator, id: string) => row.locator(`:scope > fieldset > [data-kalada-action="${id}"]`);

async function geometry(page: Page, list: Locator) {
	const measurement = await list.evaluate((element) => ({
		viewport: document.documentElement.clientWidth,
		page: document.documentElement.scrollWidth,
		buttons: [...element.querySelectorAll("button")].map((button) => {
			const rect = button.getBoundingClientRect();
			return { left: rect.left, right: rect.right, height: rect.height, label: button.textContent };
		}),
		overlaps: [...element.querySelectorAll(":scope > ol > li > fieldset")].flatMap((row) => {
			const buttons = [...row.querySelectorAll<HTMLButtonElement>(":scope > [data-kalada-action] > button")];
			return buttons.flatMap((button, index) =>
				buttons.slice(index + 1).map((other) => {
					const a = button.getBoundingClientRect();
					const b = other.getBoundingClientRect();
					return (
						Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
						Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
					);
				}),
			);
		}),
	}));
	expect(measurement.page).toBeLessThanOrEqual(measurement.viewport);
	expect(measurement.overlaps.length).toBeGreaterThan(0);
	expect(measurement.overlaps.every((area) => area === 0)).toBe(true);
	for (const button of measurement.buttons) {
		expect(button.left).toBeGreaterThanOrEqual(0);
		expect(button.right).toBeLessThanOrEqual(measurement.viewport);
		expect(button.height).toBeGreaterThanOrEqual(44);
		expect(button.label?.trim()).toBeTruthy();
	}
}

async function move(row: Locator, id: string, destination: string) {
	const key = await row.getAttribute("data-kalada-row-key");
	const stable = row.page().locator(`li[data-kalada-row-key=${JSON.stringify(key)}]`);
	const control = action(stable, id);
	await control.getByRole("combobox").selectOption(destination);
	await control.getByRole("button").press("Enter");
	await expect(control.locator("output")).toContainText("applied");
}

async function arrayRow(page: Page, form: Locator, id: string, prefix: string, label: string) {
	const list = repeater(page, id);
	const add = form.getByRole("button", { name: `Add ${label}`, exact: true });
	await expect(rows(list)).toHaveCount(0);
	await add.click();
	await expect(rows(list)).toHaveCount(1);
	const key = await rows(list).first().getAttribute("data-kalada-row-key");
	expect(key).toBeTruthy();
	await expect(action(rows(list).first(), `${prefix}-up`).getByRole("button")).toBeDisabled();
	const muted = await action(rows(list).first(), `${prefix}-up`)
		.getByRole("button")
		.evaluate((button) => getComputedStyle(button).backgroundColor);
	const available = await action(rows(list).first(), `${prefix}-remove`)
		.getByRole("button")
		.evaluate((button) => getComputedStyle(button).backgroundColor);
	expect(muted).not.toBe(available);
	await add.click();
	await expect(rows(list)).toHaveCount(2);
	const second = await rows(list).last().getAttribute("data-kalada-row-key");
	await move(rows(list).first(), `${prefix}-down`, second ?? "");
	await expect(rows(list).last()).toHaveAttribute("data-kalada-row-key", key ?? "");
	await expect(action(rows(list).last(), `${prefix}-down`).getByRole("button")).toBeFocused();
	await action(rows(list).last(), `${prefix}-remove`).getByRole("button").click();
	await expect(rows(list)).toHaveCount(1);
	if (id === "tags") await expect(rows(list).first().locator(":scope > fieldset")).toBeFocused();
	else await expect(rows(list).first().locator("input,select").first()).toBeFocused();
	await geometry(page, list);
	await action(rows(list).first(), `${prefix}-remove`).getByRole("button").click();
	await expect(rows(list)).toHaveCount(0);
	await expect(add).toBeFocused();
}

async function denyOtherScope(page: Page, form: Locator) {
	await form.getByRole("button", { name: "Add Tags", exact: true }).click();
	await form.getByRole("button", { name: "Add Team Members", exact: true }).click();
	const tag = rows(repeater(page, "tags")).first();
	const token = await tag.getAttribute("data-kalada-row-key");
	const other = await rows(repeater(page, "team-members")).first().getAttribute("data-kalada-row-key");
	const control = action(tag, "tag-down");
	await control.getByRole("combobox").selectOption(other ?? "");
	await control.getByRole("button").click();
	await expect(control.locator("output")).toContainText(": stale");
	await expect(tag).toHaveAttribute("data-kalada-row-key", token ?? "");
	await expect(rows(repeater(page, "tags"))).toHaveCount(1);
	await expect(rows(repeater(page, "team-members"))).toHaveCount(1);
	await form.getByRole("button", { name: "Reset", exact: true }).last().click();
}

test("#211 demo 8 direct and playground singleton and multirow focus", async ({ page }, info) => {
	await page.setViewportSize({ width: info.project.name === "chromium-narrow" ? 390 : 1280, height: 850 });
	for (const mode of routes) {
		await page.goto(`?mode=${mode}&demo=array-items&preset=default`);
		const form = page.locator(".schema-demo-form");
		await expect(form.locator("form[data-kalada-v1]")).toBeVisible();
		for (const [id, prefix, label] of [
			["tags", "tag", "Tags"],
			["team-members", "member", "Team Members"],
			["addresses", "address", "Office Locations"],
			["milestones", "milestone", "Milestones"],
		])
			await arrayRow(page, form, id, prefix, label);
		await denyOtherScope(page, form);
		const add = form.getByRole("button", { name: "Add Tags", exact: true });
		await add.click();
		await add.click();
		await add.click();
		await expect(rows(repeater(page, "tags"))).toHaveCount(2);
		await expect(form.locator('[data-kalada-action="tags-add"] output')).toContainText(/denied|capacity/);
		await form.getByRole("button", { name: "Reset", exact: true }).last().click();
		await expect(rows(repeater(page, "tags"))).toHaveCount(0);
	}
});

async function orderRows(page: Page, list: Locator, add: Locator) {
	await add.click();
	await expect(rows(list)).toHaveCount(1);
	await action(rows(list).first(), "line-remove").getByRole("button").click();
	await expect(rows(list)).toHaveCount(1);
	await expect(action(rows(list).first(), "line-remove").locator("output")).toContainText(/denied|capacity/);
	await rows(list).first().getByRole("textbox", { name: "Description" }).fill("Consulting");
	await rows(list).first().getByRole("spinbutton", { name: "Amount" }).fill("100");
	const key = await rows(list).first().getAttribute("data-kalada-row-key");
	await add.click();
	await rows(list).last().getByRole("textbox", { name: "Description" }).fill("Support");
	await rows(list).last().getByRole("spinbutton", { name: "Amount" }).fill("50");
	const destination = await rows(list).last().getAttribute("data-kalada-row-key");
	await move(rows(list).first(), "line-down", destination ?? "");
	await expect(rows(list).last()).toHaveAttribute("data-kalada-row-key", key ?? "");
	await expect(rows(list).last().getByRole("textbox", { name: "Description" })).toHaveValue("Consulting");
	await action(rows(list).last(), "line-remove").getByRole("button").click();
	await expect(rows(list)).toHaveCount(1);
	await expect(rows(list).first().getByRole("textbox", { name: "Description" })).toBeFocused();
	await geometry(page, list);
}

async function fillOrder(form: Locator, list: Locator) {
	await rows(list).first().getByRole("textbox", { name: "Description" }).fill("Support");
	await rows(list).first().getByRole("spinbutton", { name: "Amount" }).fill("50");
	await form.getByRole("textbox", { name: "Customer Name" }).fill("Customer");
	await form.getByLabel("Order Date").fill("2026-09-23");
	await form.getByLabel("Payment Method").selectOption({ index: 1 });
}

test("#211 demo 14 direct and playground min/max and projected submission", async ({ page }, info) => {
	test.setTimeout(60_000);
	await page.setViewportSize({ width: info.project.name === "chromium-narrow" ? 390 : 1280, height: 850 });
	for (const mode of routes) {
		await page.goto(`?mode=${mode}&demo=order-entry&preset=default`);
		const form = page.locator(".schema-demo-form");
		await expect(form.locator("form[data-kalada-v1]")).toBeVisible();
		const list = repeater(page, "line-items");
		const add = form.getByRole("button", { name: "Add Line Item", exact: true });
		await orderRows(page, list, add);
		await fillOrder(form, list);
		await expect(form.locator('[data-kalada-output="subtotal-output"]')).toContainText("50");
		for (let index = 1; index < 20; index++) await add.click();
		await expect(rows(list)).toHaveCount(20);
		await add.click();
		await expect(rows(list)).toHaveCount(20);
		await expect(form.locator('[data-kalada-action="line-add"] output')).toContainText(/denied|capacity/);
		await form.getByRole("button", { name: "Reset", exact: true }).last().click();
		await expect(rows(list)).toHaveCount(0);
		await add.click();
		await fillOrder(form, list);
		await form.getByRole("button", { name: "Submit", exact: true }).last().click();
		const result = page.getByRole("region", { name: "Last successful submission" });
		await expect(result).toContainText('"amount": 50');
		await expect(result).not.toContainText('"subtotal"');
	}
});

test("#211 does not mark unrelated demo forms", async ({ page }) => {
	await page.goto("?mode=demo&demo=kitchen-sink");
	await expect(page.locator(".schema-demo-form form[data-kalada-v1]")).toBeVisible();
	await expect(page.locator("fieldset[data-formbar-node=tags]")).toHaveCount(0);
});
