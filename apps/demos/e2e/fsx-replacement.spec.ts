import { type CDPSession, type Page, expect, test } from "@playwright/test";
import { fillSource, sourceSelection, sourceText } from "./fsx-editor-helpers";

async function rootListeners(cdp: CDPSession) {
	const { result } = await cdp.send("Runtime.evaluate", {
		expression: 'document.getElementById("root")',
		objectGroup: "listeners",
	});
	const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId });
	await cdp.send("Runtime.releaseObjectGroup", { objectGroup: "listeners" });
	return listeners.length;
}

async function singlePreview(page: Page) {
	const preview = page.getByRole("region", { name: "Running preview", exact: true });
	await expect(preview.locator("form")).toHaveCount(1);
	await expect(preview.locator("[data-kalada-v1]")).toHaveCount(1);
	const ids = await preview.locator("[id]").evaluateAll((nodes) => nodes.map((node) => node.id));
	expect(new Set(ids).size).toBe(ids.length);
}

async function previewCounts(page: Page) {
	return page.getByRole("region", { name: "Applied FSX preview", exact: true }).evaluate((element) => ({
		forms: element.querySelectorAll("form").length,
		children: element.children.length,
		widgets: element.querySelectorAll("input, output").length,
	}));
}

function revisionSource(source: string, label: string, iteration: number) {
	return source.replace(`label="${label}"`, `label="Revision ${iteration}"`);
}

for (const demo of ["quote", "line-items"]) {
	test(`FSX ${demo}: twenty source applies replace rather than append preview`, async ({ page }) => {
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`?mode=fsx&demo=${demo}`);
		const preview = page.getByRole("region", { name: "Applied FSX preview", exact: true });
		const editor = page.getByLabel("FSX source", { exact: true });
		const source = await sourceText(editor);
		const label = demo === "quote" ? "Customer" : "Description";
		const field = demo === "quote" ? "Quantity" : "Amount";
		await page.getByLabel(field, { exact: true }).first().fill("4");
		const cdp = await page.context().newCDPSession(page);
		const baseline = await rootListeners(cdp);
		const counts: unknown[] = [];
		for (let iteration = 0; iteration < 20; iteration++) {
			const oldForm = await preview.locator("form").elementHandle();
			await fillSource(editor, revisionSource(source, label, iteration));
			await page.getByRole("button", { name: "Compile and Apply" }).click();
			await expect(page.getByLabel(`Revision ${iteration}`, { exact: true }).first()).toBeVisible();
			await expect(preview).toHaveCount(1);
			await expect(preview.locator("form")).toHaveCount(1);
			await singlePreview(page);
			await expect(page.getByLabel(field, { exact: true }).first()).toHaveValue("4");
			expect(await rootListeners(cdp)).toBe(baseline);
			expect(await oldForm?.evaluate((element) => element.isConnected)).toBe(false);
			await oldForm?.evaluate((element) =>
				element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
			);
			await expect(page.getByRole("region", { name: "Last successful submission" })).toContainText(
				"No successful submission yet",
			);
			counts.push(await previewCounts(page));
		}
		console.log(JSON.stringify({ demo, counts, errors }));
		expect(errors).toEqual([]);
	});
}

test("failed/rapid Apply, null drafts, data replacement, Reset and cross-format back navigation retain one form", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("?mode=fsx&demo=quote");
	const editor = page.getByLabel("FSX source", { exact: true });
	const source = await sourceText(editor);
	await page.getByLabel("Quantity", { exact: true }).fill("");
	await fillSource(editor, source.replace("Customer", "Client"));
	await page.getByRole("button", { name: "Compile and Apply" }).dblclick();
	await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("");
	await singlePreview(page);
	const retained = await page.locator("form").elementHandle();
	await fillSource(editor, "<Form broken>");
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	await singlePreview(page);
	expect(await retained?.evaluate((node) => node.isConnected)).toBe(true);
	await fillSource(editor, source);
	await page.getByLabel("Initial JSON data", { exact: true }).fill('{"name":"Grace","quantity":3,"unitPrice":4}');
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	await expect(page.getByLabel("Customer", { exact: true })).toHaveValue("Grace");
	await singlePreview(page);
	await page.getByRole("button", { name: "Reset example" }).click();
	await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("2");
	await singlePreview(page);
	await page.getByLabel("Demo", { exact: true }).selectOption("fsx-line-items");
	await singlePreview(page);
	await page.getByLabel("Demo", { exact: true }).selectOption("basic-contact");
	await singlePreview(page);
	await page.goBack();
	await expect(editor).toBeVisible();
	await singlePreview(page);
	await page.goBack();
	await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("2");
	await singlePreview(page);
	expect(errors).toEqual([]);
});

test("duplicate ID messages link both exact UTF-16 declarations and expire when editing", async ({ page }) => {
	await page.goto("?mode=fsx&demo=quote");
	const editor = page.getByLabel("FSX source", { exact: true });
	const text =
		'<Form id="quote" defaultLanguage="Kalada"><Output id="astral" value={"😀"}/><Field id="quantity" widget="number" value={quantity}/><Field id="quantity" widget="number" value={quantity}/></Form>';
	await fillSource(editor, text);
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	const diagnostics = page.getByRole("list", { name: "Source diagnostics" });
	await expect(diagnostics.getByRole("button").first()).toHaveText(
		'ID "quantity" is already used by <Field>. Choose a unique element ID; both may still bind to the same field.',
	);
	await expect(diagnostics.locator("details").first()).not.toHaveAttribute("open", "");
	await diagnostics.getByRole("button").first().click();
	expect((await sourceSelection(editor))[0]).toBe(text.lastIndexOf('"quantity"'));
	const first = diagnostics.getByRole("button", { name: "First declared on <Field> here." });
	await first.focus();
	await page.keyboard.press("Enter");
	expect(await sourceSelection(editor)).toEqual([text.indexOf('"quantity"'), text.indexOf('"quantity"') + 10]);
	await fillSource(editor, text.replace('id="astral"', 'id="new"'));
	await expect(diagnostics).toBeEmpty();
	await singlePreview(page);
});

test("untrusted ID text is rendered as text, not diagnostic HTML", async ({ page }) => {
	await page.goto("?mode=fsx&demo=quote");
	const id = '<img src=x onerror="window.idExecuted=true">';
	const value = JSON.stringify(id);
	await fillSource(
		page.getByLabel("FSX source", { exact: true }),
		`<Form id="quote" defaultLanguage="Kalada"><Output id=${value} value={"one"}/><Output id=${value} value={"two"}/></Form>`,
	);
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	const diagnostics = page.getByRole("list", { name: "Source diagnostics" });
	await expect(diagnostics.getByRole("button").first()).toContainText(JSON.stringify(id));
	await expect(diagnostics.locator("img")).toHaveCount(0);
	expect(await page.evaluate(() => Object.hasOwn(window, "idExecuted"))).toBe(false);
	await singlePreview(page);
});

test("changing Form.id cannot reuse the sealed live draft and retains exactly one previous preview", async ({
	page,
}) => {
	await page.goto("?mode=fsx&demo=quote");
	const editor = page.getByLabel("FSX source", { exact: true });
	const source = await sourceText(editor);
	await page.getByLabel("Quantity", { exact: true }).fill("4");
	const retained = await page.locator("form").elementHandle();
	await fillSource(editor, source.replace('id="quote"', 'id="different-form"'));
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	await expect(page.getByRole("list", { name: "Source diagnostics" })).toContainText("Foreign draft preset or form");
	await singlePreview(page);
	expect(await retained?.evaluate((node) => node.isConnected)).toBe(true);
	await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("4");
});
