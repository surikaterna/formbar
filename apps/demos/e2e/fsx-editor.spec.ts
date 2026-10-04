import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { fillSource, sourceSelection, sourceText } from "./fsx-editor-helpers";

test("Ctrl+Enter applies the latest draft, retains live data, and matches button/data/reset behavior", async ({
	page,
}, testInfo) => {
	test.skip(
		testInfo.project.name === "chromium-narrow",
		"Android CodeMirror defers native Enter without modifiers; hardware shortcuts are desktop coverage.",
	);
	await page.goto("?mode=fsx&demo=quote");
	const editor = page.getByRole("textbox", { name: "FSX source", exact: true });
	const original = await sourceText(editor);
	await page.getByLabel("Quantity", { exact: true }).fill("6");
	const latest = original.replace('label="Customer"', 'label="Shortcut client"');
	await editor.fill(latest);
	await editor.press("Control+Enter");
	await expect(page.getByLabel("Shortcut client", { exact: true })).toHaveValue("Ada");
	await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("6");
	await expect.poll(() => sourceText(editor)).toBe(latest);
	await expect(page.getByRole("list", { name: "Source diagnostics" })).toBeEmpty();
	await editor.fill(latest.replace("Shortcut client", "Button client"));
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	await expect(page.getByLabel("Button client", { exact: true })).toHaveValue("Ada");
	await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("6");
	await page.getByLabel("Initial JSON data", { exact: true }).fill('{"name":"Grace","quantity":3,"unitPrice":4}');
	await editor.press("Control+Enter");
	await expect(page.getByLabel("Button client", { exact: true })).toHaveValue("Grace");
	await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("3");
	await page.getByRole("button", { name: "Reset example" }).click();
	await expect.poll(() => sourceText(editor)).toBe(original);
	await expect(page.getByLabel("Customer", { exact: true })).toHaveValue("Ada");
	await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("2");
	await editor.fill(original.replace("Customer", "After reset"));
	await editor.press("Control+Enter");
	await expect(page.getByLabel("After reset", { exact: true })).toHaveValue("Ada");
});

test("failed shortcut prevents default, retains preview, and navigates exact UTF-16 diagnostics", async ({
	page,
}, testInfo) => {
	await page.goto("?mode=fsx&demo=quote");
	const editor = page.getByLabel("FSX source", { exact: true });
	const retained = await page.locator("form").elementHandle();
	const draft =
		'<Form id="quote" defaultLanguage="Kalada">\n<Output id="astral" value={"😀"}/><Field id="quantity" widget="number" value={quantity}/><Field id="quantity" widget="number" value={quantity}/></Form>';
	await fillSource(editor, draft);
	if (testInfo.project.name === "chromium-desktop") await editor.press("Control+Enter");
	const prevented = await editor.evaluate((element) => {
		const event = new KeyboardEvent("keydown", {
			key: "Enter",
			code: "Enter",
			ctrlKey: true,
			bubbles: true,
			cancelable: true,
		});
		element.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(true);
	const diagnostics = page.getByRole("list", { name: "Source diagnostics" });
	await expect(diagnostics).toContainText('ID "quantity" is already used');
	expect(await retained?.evaluate((element) => element.isConnected)).toBe(true);
	await diagnostics.getByRole("button").first().click();
	await expect(editor).toBeFocused();
	expect(await sourceSelection(editor)).toEqual([
		draft.lastIndexOf('"quantity"'),
		draft.lastIndexOf('"quantity"') + 10,
	]);
	await diagnostics.getByRole("button", { name: "First declared on <Field> here." }).click();
	expect(await sourceSelection(editor)).toEqual([draft.indexOf('"quantity"'), draft.indexOf('"quantity"') + 10]);
	await expect.poll(() => sourceText(editor)).toBe(draft);
});

test("navigation unmounts the source view and remounts exactly one working editor", async ({ page }, testInfo) => {
	test.skip(
		testInfo.project.name === "chromium-narrow",
		"Android CodeMirror defers native Enter without modifiers; hardware shortcuts are desktop coverage.",
	);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	await page.goto("?mode=fsx&demo=quote");
	const editor = page.getByLabel("FSX source", { exact: true });
	const old = await editor.elementHandle();
	await page.getByLabel("Demo", { exact: true }).selectOption("basic-contact");
	expect(await old?.evaluate((element) => element.isConnected)).toBe(false);
	await old?.evaluate((element) =>
		element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })),
	);
	await page.goBack();
	await expect(page.locator(".cm-editor")).toHaveCount(1);
	await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("2");
	await editor.fill((await sourceText(editor)).replace("Customer", "Remounted"));
	await editor.press("Control+Enter");
	await expect(page.getByLabel("Remounted", { exact: true })).toHaveValue("Ada");
	await expect(page.getByText("Preview: applied revision 2.", { exact: false })).toBeVisible();
	expect(errors).toEqual([]);
});

test("copy tracks the focused editor including diagnostic navigation; download contains both current drafts", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.goto("?mode=fsx&demo=quote");
	const editor = page.getByLabel("FSX source", { exact: true });
	const source = '<Form id="quote" defaultLanguage="Kalada"><Field id="bad" widget="text" value={unknown}/></Form>';
	const json = '{"name":"Grace","quantity":3,"unitPrice":4}';
	await fillSource(editor, source);
	await page.getByRole("button", { name: "Copy active" }).click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(source);
	await page.getByLabel("Initial JSON data", { exact: true }).fill(json);
	await page.getByRole("button", { name: "Copy active" }).click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(json);
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	await page.getByRole("list", { name: "Source diagnostics" }).getByRole("button").first().click();
	await page.getByRole("button", { name: "Copy active" }).click();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(source);
	const downloaded = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download FSX + initial JSON" }).click();
	const download = await downloaded;
	expect(download.suggestedFilename()).toBe("formbar-fsx-quote-draft.json");
	const path = await download.path();
	if (!path) throw new Error("Missing draft download");
	expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
		format: "fsx-source-and-initial-data",
		source,
		initialJson: json,
	});
});
