import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { fillSource, sourceSelection, sourceText } from "./fsx-editor-helpers";

test("shared sidebar, shell and keyboard selector preserve the selected demo across JSON and FSX", async ({
	page,
}, testInfo) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("?mode=demo&demo=basic-contact");
	const browse = page.getByRole("button", { name: /Browse demos/ });
	if (await browse.isVisible()) {
		await browse.focus();
		await page.keyboard.press("Enter");
	}
	const quote = page.getByRole("button", { name: /Reactive quote/ });
	await quote.focus();
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(/mode=demo&demo=fsx-quote/);
	await expect(page.getByLabel("Customer", { exact: true })).toHaveValue("Ada");
	if (await browse.isVisible()) await expect(browse).toBeFocused();
	await page.getByLabel("Quantity", { exact: true }).fill("7");
	await expect(page.getByLabel("Current data", { exact: true })).toContainText('"quantity": 7');
	await page.getByText("Source and initial JSON", { exact: true }).click();
	await expect(page.getByRole("region", { name: "FSX sources" })).toContainText('<Form id="quote"');
	await page.screenshot({ path: testInfo.outputPath("fsx-demo.png"), fullPage: true });
	await page.getByRole("button", { name: "Open in Playground" }).click();
	const selector = page.getByLabel("Demo", { exact: true });
	await expect(selector).toHaveValue("fsx-quote");
	await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("2");
	await expect(page.getByRole("button", { name: "Format active" })).toHaveCount(0);
	await selector.focus();
	await selector.selectOption("multi-schema-sources");
	await expect(selector).toBeFocused();
	await expect(page.getByRole("tab", { name: "Schema", exact: true })).toBeVisible();
	await expect(page.getByText("Fixed trusted runtime context (read-only)")).toBeVisible();
	await page.getByRole("button", { name: "Apply", exact: true }).click();
	await page.getByRole("button", { name: "Reset example" }).click();
	await selector.focus();
	await selector.selectOption("fsx-line-items");
	await expect(selector).toBeFocused();
	await page.getByLabel("Description", { exact: true }).first().fill("Integrated journey");
	await page.screenshot({ path: testInfo.outputPath("shared-fsx-playground.png"), fullPage: true });
	await page.getByRole("button", { name: "Submit", exact: true }).click();
	await expect(page.getByRole("region", { name: "Last successful submission" })).toContainText("Integrated journey");
	await page.getByRole("button", { name: "← Demo" }).click();
	await expect(page).toHaveURL(/mode=demo&demo=fsx-line-items/);
	if (await browse.isVisible()) {
		await expect(browse).toContainText("Writable line items");
		await browse.click();
	}
	await expect(page.locator('aside [aria-current="page"]')).toContainText("Writable line items");
	await expect(page.locator('aside [aria-current="page"]')).toBeInViewport();
	await page.goBack();
	await expect(selector).toHaveValue("fsx-line-items");
	await page.goBack();
	await expect(selector).toHaveValue("multi-schema-sources");
	expect(errors).toEqual([]);
});

test("legacy aliases canonicalize and diagnostics remain keyboard-ranged in the common shell", async ({ page }) => {
	await page.goto("?mode=fsx&demo=quote&preset=untrusted&profile=untrusted#docs");
	await expect(page).toHaveURL(/mode=playground&demo=fsx-quote&profile=untrusted#docs/);
	const editor = page.getByLabel("FSX source", { exact: true });
	const original = await sourceText(editor);
	await fillSource(editor, original.replace("value={name}", "value={unregistered}"));
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	const diagnostic = page.getByRole("list", { name: "Source diagnostics" }).getByRole("button").first();
	await diagnostic.focus();
	await page.keyboard.press("Enter");
	await expect(editor).toBeFocused();
	const [from, to] = await sourceSelection(editor);
	expect(to - from).toBeGreaterThan(0);
	await fillSource(editor, original);
	await expect(page.getByRole("list", { name: "Source diagnostics" })).toBeEmpty();
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	await fillSource(editor, original.replace('id="unit-price"', 'id="name"'));
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	await expect(page.getByRole("list", { name: "Source diagnostics" })).not.toBeEmpty();
	await expect(page.getByText(/Unapplied draft — previous successful preview remains active/)).toBeVisible();
	await expect(page.getByLabel("Customer", { exact: true })).toHaveValue("Ada");
	await fillSource(editor, original);
	const download = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download FSX + initial JSON" }).click();
	const file = await download;
	expect(file.suggestedFilename()).toBe("formbar-fsx-quote-draft.json");
	const path = await file.path();
	if (!path) throw new Error("Missing downloaded source bundle");
	expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
		format: "fsx-source-and-initial-data",
		source: original,
		initialJson: JSON.stringify({ name: "Ada", quantity: 2, unitPrice: 12.5 }, null, 2),
	});
	await page.goto("?mode=playground&demo=fsx-unregistered");
	await expect(page.getByLabel("Demo", { exact: true })).toHaveValue("basic-contact");
	await expect(page.getByLabel("FSX source", { exact: true })).toHaveCount(0);
});
