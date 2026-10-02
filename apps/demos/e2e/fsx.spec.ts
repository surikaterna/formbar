import { expect, test } from "@playwright/test";

test("FSX navigation, reactive quote, source apply, diagnostics and reset", async ({ page }) => {
	await page.goto("?mode=demo&demo=basic-contact");
	if (await page.getByRole("button", { name: /Browse demos/ }).isVisible())
		await page.getByRole("button", { name: /Browse demos/ }).click();
	await page.getByRole("button", { name: /Reactive quote/ }).click();
	await page.getByRole("button", { name: "Open in Playground" }).click();
	await expect(page).toHaveURL(/mode=playground&demo=fsx-quote/);
	await expect(page.getByRole("heading", { name: "Interactive playground" })).toBeVisible();
	await page.getByLabel("Quantity", { exact: true }).fill("6");
	await expect(page.locator("output").filter({ hasText: "75" })).toBeVisible();
	await expect(page.locator("output").filter({ hasText: "Bulk order" })).toBeVisible();
	const editor = page.getByLabel("FSX source", { exact: true });
	const source = await editor.inputValue();
	await editor.fill(source.replace('label="Customer"', 'label="Client"'));
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	await expect(page.getByLabel("Client", { exact: true })).toHaveValue("Ada");
	await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("6");
	await editor.fill('<Form id="bad" defaultLanguage="Kalada"><Field id="evil" widget="text" value={secret}/></Form>');
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	await expect(page.getByRole("list", { name: "Source diagnostics" })).toContainText("UTF-16");
	await page.getByRole("list", { name: "Source diagnostics" }).getByRole("button").first().click();
	expect(
		await editor.evaluate((element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart),
	).toBeGreaterThan(0);
	await expect(page.getByLabel("Client", { exact: true })).toHaveValue("Ada");
	await editor.fill('<Form id="broken" defaultLanguage="Kalada"><Field');
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	await expect(page.getByRole("list", { name: "Source diagnostics" })).toContainText("UTF-16");
	await page.getByLabel("Quantity", { exact: true }).fill("8");
	await expect(page.locator("output").filter({ hasText: "100" })).toBeVisible();
	await page.getByRole("button", { name: "Reset example" }).click();
	await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("2");
	await expect(editor).toHaveValue(source);
});

test("FSX initial JSON is data only; invalid Apply retains preview and valid replacement submits", async ({ page }) => {
	await page.goto("?mode=fsx&demo=quote");
	const data = page.getByLabel("Initial JSON data", { exact: true });
	await data.fill('{"__proto__":{},"name":"evil"}');
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	await expect(page.getByRole("list", { name: "Source diagnostics" })).toContainText("Unsafe JSON key");
	await expect(page.getByLabel("Customer", { exact: true })).toHaveValue("Ada");
	await data.fill('{"name":"Grace","quantity":3,"unitPrice":4}');
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	await expect(page.locator("output").filter({ hasText: "12" })).toBeVisible();
	await page.getByRole("button", { name: "Submit", exact: true }).click();
	await expect(page.getByRole("region", { name: "Last successful submission" })).toContainText('"name": "Grace"');
	await page.getByRole("button", { name: "Reset example" }).click();
	await expect(page.getByLabel("Customer", { exact: true })).toHaveValue("Ada");
	await expect(page.getByRole("region", { name: "Last successful submission" })).toContainText(
		"No successful submission yet",
	);
});

test("FSX repeaters write, reorder, remove, submit and survive deep-link/popstate navigation", async ({ page }) => {
	await page.goto("?mode=fsx&demo=line-items");
	await page.getByLabel("Description", { exact: true }).first().fill("Consulting");
	await page.getByLabel("Amount", { exact: true }).first().fill("30");
	await page.getByLabel("Tag", { exact: true }).first().fill("priority");
	await expect(page.getByLabel("Current data", { exact: true })).toContainText("Consulting");
	await expect(page.getByLabel("Current data", { exact: true })).toContainText("priority");
	const move = page.getByRole("button", { name: "Move row" }).first();
	await move.locator("..").getByRole("combobox").selectOption({ index: 2 });
	await move.click();
	await expect(page.getByLabel("Description", { exact: true }).nth(1)).toHaveValue("Consulting");
	await page
		.getByRole("button", { name: /Remove/i })
		.first()
		.click();
	await expect(page.getByLabel("Description", { exact: true })).toHaveCount(1);
	await page.getByRole("button", { name: "Submit", exact: true }).click();
	await expect(page.getByRole("region", { name: "Last successful submission" })).toContainText("Consulting");
	await page.getByLabel("Demo", { exact: true }).selectOption("fsx-quote");
	await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("2");
	await page.goBack();
	await expect(page.getByLabel("Description", { exact: true }).first()).toHaveValue("Design");
	await page.reload();
	await expect(page.getByLabel("Demo", { exact: true })).toHaveValue("fsx-line-items");
});

for (const invalid of [
	{ label: "Quantity", value: "-1", data: { quantity: -1 } },
	{ label: "Customer", value: "", data: { name: "" } },
]) {
	test(`FSX source-only Apply retains invalid ${invalid.label}; edited initial JSON still rejects it`, async ({
		page,
	}) => {
		await page.goto("?mode=fsx&demo=quote");
		await page.getByLabel(invalid.label, { exact: true }).fill(invalid.value);
		const editor = page.getByLabel("FSX source", { exact: true });
		const source = await editor.inputValue();
		await editor.fill(source.replace('label="Customer"', 'label="Client"'));
		await page.getByRole("button", { name: "Compile and Apply" }).click();
		await expect(page.getByLabel("Client", { exact: true })).toHaveValue(invalid.label === "Customer" ? "" : "Ada");
		await expect(page.getByLabel(invalid.label === "Customer" ? "Client" : "Quantity", { exact: true })).toHaveValue(
			invalid.value,
		);
		await expect(page.getByRole("list", { name: "Source diagnostics" })).toBeEmpty();
		await expect(page.locator("[data-kalada-v1]")).toContainText("valid: false");
		await page.getByRole("button", { name: "Submit", exact: true }).click();
		await expect(page.locator("[data-kalada-v1]")).toContainText("denied");
		await expect(page.getByRole("region", { name: "Last successful submission" })).toContainText(
			"No successful submission yet",
		);
		await page
			.getByLabel("Initial JSON data", { exact: true })
			.fill(JSON.stringify({ name: "Ada", quantity: 2, unitPrice: 12.5, ...invalid.data }));
		await page.getByRole("button", { name: "Compile and Apply" }).click();
		await expect(page.getByRole("list", { name: "Source diagnostics" })).toContainText("DEMO_INPUT_INVALID");
		await expect(page.getByLabel(invalid.label === "Customer" ? "Client" : "Quantity", { exact: true })).toHaveValue(
			invalid.value,
		);
	});
}

for (const blank of [
	{ demo: "quote", label: "Quantity", after: "Quantity", output: "50" },
	{ demo: "quote", label: "Unit price", after: "Unit price", output: "8" },
	{ demo: "line-items", label: "Amount", after: "Amount", output: "8" },
]) {
	test(`FSX blank ${blank.label} is a recoverable null draft across Apply and strict JSON refusal`, async ({
		page,
	}) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`?mode=fsx&demo=${blank.demo}`);
		await page.getByLabel(blank.label, { exact: true }).first().fill("");
		await expect(page.getByLabel("FSX source", { exact: true })).toBeVisible();
		await expect(page.getByLabel("Current data", { exact: true })).toContainText("null");
		await page.getByRole("button", { name: "Submit", exact: true }).click();
		await expect(page.locator("[data-kalada-v1]")).toContainText("denied");
		const editor = page.getByLabel("FSX source", { exact: true });
		await editor.fill((await editor.inputValue()).replace('label="', 'label= "'));
		await page.getByRole("button", { name: "Compile and Apply" }).click();
		await expect(page.getByRole("list", { name: "Source diagnostics" })).toBeEmpty();
		await expect(page.getByLabel(blank.after, { exact: true }).first()).toHaveValue("");
		await expect(page.locator("[data-kalada-v1]")).toContainText("valid: false");
		await page
			.getByLabel("Initial JSON data", { exact: true })
			.fill(await page.getByLabel("Current data", { exact: true }).innerText());
		await page.getByRole("button", { name: "Compile and Apply" }).click();
		await expect(page.getByRole("list", { name: "Source diagnostics" })).toContainText("DEMO_INPUT_INVALID");
		await page.getByLabel(blank.after, { exact: true }).first().fill("4");
		await expect(
			page
				.locator("output")
				.filter({ hasText: new RegExp(`^${blank.output}$`) })
				.first(),
		).toBeVisible();
		await page.getByRole("button", { name: "Submit", exact: true }).click();
		await expect(page.getByRole("region", { name: "Last successful submission" })).not.toContainText(
			"No successful submission yet",
		);
		expect(errors).toEqual([]);
	});
}

test("FSX computed-preview errors stay contextual; source correction and Reset remain usable", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("?mode=fsx&demo=quote");
	const editor = page.getByLabel("FSX source", { exact: true });
	const safeSource = await editor.inputValue();
	const brokenSource = safeSource.replace('quantity == null || unitPrice == null ? "Enter both numbers" : ', "");
	await editor.fill(brokenSource);
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	await page.getByLabel("Quantity", { exact: true }).fill("");
	await expect(editor).toBeVisible();
	await expect(page.getByRole("alert").first()).toContainText("KALADA_OPERATOR_TYPE");
	await page.getByRole("button", { name: "Reset", exact: true }).click();
	await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("2");
	await page.getByLabel("Quantity", { exact: true }).fill("");
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	await expect(page.getByRole("list", { name: "Source diagnostics" })).toContainText("PREVIEW_EVALUATION_FAILED");
	await editor.fill(safeSource);
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("");
	await expect(page.locator("output").filter({ hasText: "Enter both numbers" })).toBeVisible();
	await page.getByRole("button", { name: "Reset example" }).click();
	await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("2");
	expect(errors).toEqual([]);
});

test("FSX null transfers survive repeated source revisions and retire on Reset/preset navigation", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("?mode=fsx&demo=quote");
	await page.getByLabel("Quantity", { exact: true }).fill("");
	const editor = page.getByLabel("FSX source", { exact: true });
	await editor.fill((await editor.inputValue()).replace("Customer", "Client"));
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	await expect(page.getByLabel("Client", { exact: true })).toHaveValue("Ada");
	await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("");
	await page.getByLabel("Unit price", { exact: true }).fill("");
	await editor.fill((await editor.inputValue()).replace('label="Total"', 'label="Quote total"'));
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	await expect(page.getByRole("list", { name: "Source diagnostics" })).toBeEmpty();
	await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("");
	await expect(page.getByLabel("Unit price", { exact: true })).toHaveValue("");
	await page.getByRole("button", { name: "Submit", exact: true }).click();
	await expect(page.locator("[data-kalada-v1]")).toContainText("denied");
	await page.getByRole("button", { name: "Reset example" }).click();
	await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("2");
	await page.getByLabel("Demo", { exact: true }).selectOption("fsx-line-items");
	await expect(page.getByLabel("Amount", { exact: true }).first()).toHaveValue("20");
	await page.goBack();
	await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("2");
	expect(errors).toEqual([]);
});
