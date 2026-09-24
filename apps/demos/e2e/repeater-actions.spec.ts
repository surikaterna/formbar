import { type Locator, type Page, expect, test } from "@playwright/test";

const routes = ["demo", "playground"] as const;

function repeater(page: Page, id: string): Locator {
	return page.locator(`.schema-demo-form fieldset[data-formbar-node="${id}"]`);
}

function rows(list: Locator): Locator {
	return list.locator(":scope > ol > li");
}

function action(row: Locator, id: string): Locator {
	return row.locator(`:scope > fieldset > [data-formbar-node="${id}"] > button`);
}

async function checkGeometry(page: Page, list: Locator) {
	const measurements = await list.evaluate((element) => {
		const viewport = document.documentElement.clientWidth;
		const buttons = [...element.querySelectorAll<HTMLButtonElement>("button[data-formbar-array-operation]")];
		const overlaps = [...element.querySelectorAll(":scope > ol > li > fieldset")].flatMap((row) => {
			const controls = [...row.querySelectorAll<HTMLButtonElement>(":scope > [data-formbar-action] > button")].filter(
				(button) => button.getClientRects().length,
			);
			return controls.flatMap((button, index) =>
				controls.slice(index + 1).map((other) => {
					const a = button.getBoundingClientRect();
					const b = other.getBoundingClientRect();
					return (
						Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
						Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
					);
				}),
			);
		});
		return {
			viewport,
			pageWidth: document.documentElement.scrollWidth,
			rowCount: element.querySelectorAll(":scope > ol > li").length,
			overlaps,
			buttons: buttons
				.filter((button) => button.getClientRects().length)
				.map((button) => {
					const rect = button.getBoundingClientRect();
					return { left: rect.left, right: rect.right, height: rect.height, text: button.textContent };
				}),
		};
	});
	expect(measurements.pageWidth).toBeLessThanOrEqual(measurements.viewport);
	if (measurements.rowCount > 1) expect(measurements.overlaps.length).toBeGreaterThan(0);
	expect(measurements.overlaps.every((area) => area === 0)).toBe(true);
	for (const rect of measurements.buttons) {
		expect(rect.left).toBeGreaterThanOrEqual(0);
		expect(rect.right).toBeLessThanOrEqual(measurements.viewport);
		expect(rect.height).toBeGreaterThanOrEqual(44);
		expect(rect.text?.trim()).toBeTruthy();
	}
}

async function checkMuted(button: Locator, available: Locator) {
	const unavailableStyle = await button.evaluate((element) => getComputedStyle(element).backgroundColor);
	const availableStyle = await available.evaluate((element) => getComputedStyle(element).backgroundColor);
	expect(unavailableStyle).not.toBe(availableStyle);
}

async function checkNestedIsolation(row: Locator, id: string, repeaterId: string) {
	await row.locator(":scope > fieldset").evaluate(
		(fieldset, actionId) => {
			const [nodeId, nestedId] = actionId;
			for (const [repeaterNode, actionNode, label] of [
				[nestedId, nodeId, "Nested move"],
				["unrelated-nested", "unrelated-up", "Unrelated move"],
			]) {
				const nested = document.createElement("fieldset");
				nested.dataset.formbarNode = repeaterNode;
				const list = nested.appendChild(document.createElement("ol"));
				const item = list.appendChild(document.createElement("li"));
				const control = item.appendChild(document.createElement("fieldset")).appendChild(document.createElement("div"));
				control.dataset.formbarNode = actionNode;
				control.dataset.formbarAction = "array.move";
				control.appendChild(document.createElement("button")).textContent = label;
				fieldset.append(nested);
			}
		},
		[id, repeaterId],
	);
	const nested = row.getByRole("button", { name: "Nested move" });
	const unrelated = row.getByRole("button", { name: "Unrelated move" });
	const styles = await nested.evaluate((button) => {
		const peer = button.closest("li")?.parentElement?.parentElement?.nextElementSibling?.querySelector("button");
		if (!peer) throw new Error("Missing unrelated action");
		const observed = getComputedStyle(button);
		const reference = getComputedStyle(peer);
		return {
			display: getComputedStyle(button.parentElement as HTMLElement).display,
			minHeight: observed.minHeight,
			peerMinHeight: reference.minHeight,
			padding: observed.padding,
			peerPadding: reference.padding,
		};
	});
	expect(styles.display).not.toBe("none");
	expect(styles.minHeight).not.toBe("44px");
	expect(styles.minHeight).toBe(styles.peerMinHeight);
	expect(styles.padding).toBe(styles.peerPadding);
	await nested.focus();
	await expect(nested).toBeFocused();
	await row.page().keyboard.press("Tab");
	await expect(unrelated).toBeFocused();
	await row
		.locator(`fieldset[data-formbar-node="${repeaterId}"]`)
		.last()
		.evaluate((element) => element.remove());
	await row.locator('[data-formbar-node="unrelated-nested"]').evaluate((element) => element.remove());
}

async function checkArrayRow(page: Page, form: Locator, id: string, prefix: string, label: string) {
	const list = repeater(page, id);
	await expect(rows(list)).toHaveCount(0);
	const add = form.getByRole("button", { name: `Add ${label}` });
	await add.click();
	await expect(rows(list)).toHaveCount(1);
	const first = rows(list).first();
	for (const direction of ["up", "down"]) {
		await expect(action(first, `${prefix}-${direction}`)).toBeHidden();
		await expect(first.getByRole("button", { name: `Move ${direction}, item 1` })).toHaveCount(0);
	}
	await checkNestedIsolation(first, `${prefix}-up`, id);
	await expect(action(first, `${prefix}-remove`)).toBeVisible();
	await add.click();
	await expect(rows(list)).toHaveCount(2);
	await expect(action(first, `${prefix}-up`)).toHaveAttribute("aria-disabled", "true");
	await expect(action(first, `${prefix}-down`)).not.toHaveAttribute("aria-disabled", "true");
	await expect(action(rows(list).last(), `${prefix}-down`)).toHaveAttribute("aria-disabled", "true");
	await checkMuted(action(first, `${prefix}-up`), action(first, `${prefix}-down`));
	await action(first, `${prefix}-up`).focus();
	await expect(action(first, `${prefix}-up`)).toBeFocused();
	await page.keyboard.press("Tab");
	await expect(action(first, `${prefix}-down`)).toBeFocused();
	await action(rows(list).last(), `${prefix}-up`).press("Enter");
	await expect(action(first, `${prefix}-up`)).toBeFocused();
	await action(rows(list).last(), `${prefix}-remove`).click();
	await expect(rows(list)).toHaveCount(1);
	await expect(action(first, `${prefix}-up`)).toBeHidden();
	await expect(first.locator("input, select").first()).toBeFocused();
	await checkGeometry(page, list);
	await action(first, `${prefix}-remove`).click();
	await expect(rows(list)).toHaveCount(0);
	await expect(add).toBeFocused();
}

test("#211 demo 8 direct and playground singleton and multirow focus", async ({ page }, testInfo) => {
	await page.setViewportSize({ width: testInfo.project.name === "chromium-narrow" ? 390 : 1280, height: 850 });
	for (const mode of routes) {
		await page.goto(`?mode=${mode}&demo=array-items&preset=default`);
		const form = page.locator('.schema-demo-form[data-repeater-demo="array-items"]');
		await expect(form).toBeVisible();
		for (const [id, prefix, label] of [
			["tags", "tag", "Tags"],
			["team-members", "member", "Team Members"],
			["addresses", "address", "Office Locations"],
			["milestones", "milestone", "Milestones"],
		] as const)
			await checkArrayRow(page, form, id, prefix, label);
		const tags = repeater(page, "tags");
		await form.getByRole("button", { name: "Add Tags" }).click();
		await form.getByRole("button", { name: "Add Tags" }).click();
		await expect(rows(tags)).toHaveCount(2);
		await expect(form.getByRole("button", { name: "Add Tags" })).toBeDisabled();
		await expect(form.locator('[data-formbar-node="tags-add"] output')).toContainText("unavailable");
		await checkMuted(form.getByRole("button", { name: "Add Tags" }), action(rows(tags).first(), "tag-down"));
		await checkGeometry(page, tags);
		await tags.screenshot({ path: testInfo.outputPath(`demo8-${mode}-${testInfo.project.name}.png`) });
		await form.getByRole("button", { name: "Reset" }).click();
		await expect(rows(tags)).toHaveCount(0);
	}
});

async function checkOrderRows(list: Locator, add: Locator) {
	await expect(rows(list)).toHaveCount(0);
	await add.click();
	await expect(rows(list)).toHaveCount(1);
	await expect(action(rows(list).first(), "line-up")).toBeHidden();
	await expect(action(rows(list).first(), "line-down")).toBeHidden();
	await checkNestedIsolation(rows(list).first(), "line-up", "line-items");
	await expect(action(rows(list).first(), "line-remove")).toBeDisabled();
	await checkMuted(action(rows(list).first(), "line-remove"), add);
	await rows(list).first().getByRole("textbox", { name: "Description" }).fill("Consulting");
	await rows(list).first().getByRole("spinbutton", { name: "Amount" }).fill("100");
	await add.click();
	await expect(rows(list)).toHaveCount(2);
	await expect(action(rows(list).first(), "line-down")).toBeVisible();
	await rows(list).last().getByRole("textbox", { name: "Description" }).fill("Support");
	await rows(list).last().getByRole("spinbutton", { name: "Amount" }).fill("50");
	await action(rows(list).first(), "line-down").press("Space");
	await expect(action(rows(list).last(), "line-down")).toBeFocused();
	await expect(rows(list).last().getByRole("textbox", { name: "Description" })).toHaveValue("Consulting");
	await action(rows(list).last(), "line-remove").click();
	await expect(rows(list)).toHaveCount(1);
	await expect(rows(list).first().getByRole("textbox", { name: "Description" })).toBeFocused();
}

async function fillOrder(form: Locator, list: Locator) {
	await rows(list).first().getByRole("textbox", { name: "Description" }).fill("Support");
	await rows(list).first().getByRole("spinbutton", { name: "Amount" }).fill("50");
	await form.getByRole("textbox", { name: "Customer Name" }).fill("Customer");
	await form.getByLabel("Order Date").fill("2026-09-23");
	await form.getByLabel("Payment Method").selectOption({ index: 1 });
}

async function checkOrderLimit(page: Page, form: Locator, list: Locator, add: Locator) {
	for (let index = 1; index < 20; index++) {
		await rows(list).last().getByRole("textbox", { name: "Description" }).fill(`Item ${index}`);
		await rows(list).last().getByRole("spinbutton", { name: "Amount" }).fill("1");
		await add.click();
	}
	await expect(rows(list)).toHaveCount(20);
	await expect(add).toBeDisabled();
	await checkMuted(add, action(rows(list).first(), "line-down"));
	await expect(action(rows(list).first(), "line-up")).toHaveAttribute("aria-disabled", "true");
	await expect(action(rows(list).last(), "line-down")).toHaveAttribute("aria-disabled", "true");
	await checkGeometry(page, list);
	await rows(list).last().getByRole("textbox", { name: "Description" }).fill("Final item");
	await rows(list).last().getByRole("spinbutton", { name: "Amount" }).fill("1");
	await form.getByRole("button", { name: "Reset" }).click();
	await expect(rows(list)).toHaveCount(0);
}

test("#211 demo 14 direct and playground min/max and projected submission", async ({ page }, testInfo) => {
	await page.setViewportSize({ width: testInfo.project.name === "chromium-narrow" ? 390 : 1280, height: 850 });
	for (const mode of routes) {
		await page.goto(`?mode=${mode}&demo=order-entry&preset=default`);
		const form = page.locator('.schema-demo-form[data-repeater-demo="order-entry"]');
		await expect(form).toBeVisible();
		const list = repeater(page, "line-items");
		const add = form.getByRole("button", { name: "Add Line Item" });
		await checkOrderRows(list, add);
		await fillOrder(form, list);
		await expect(form.locator('[data-formbar-node="subtotal-output"]')).toContainText("50");
		await checkGeometry(page, list);
		await list.screenshot({ path: testInfo.outputPath(`demo14-${mode}-${testInfo.project.name}.png`) });
		await checkOrderLimit(page, form, list, add);
		await add.click();
		await fillOrder(form, list);
		await form.getByRole("button", { name: "Submit" }).click();
		const result = page.getByText("Last successful submission", { exact: true }).locator("..");
		await expect(result).toContainText('"lineItems"');
		await expect(result).toContainText('"amount": 50');
		await expect(result).not.toContainText('"subtotal"');
	}
});

test("#211 does not mark unrelated demo forms", async ({ page }) => {
	await page.goto("?mode=demo&demo=kitchen-sink");
	await expect(page.locator(".schema-demo-form")).toBeVisible();
	await expect(page.locator(".schema-demo-form[data-repeater-demo]")).toHaveCount(0);
});
