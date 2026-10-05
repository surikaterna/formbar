import { expect, test } from "@playwright/test";
import { appearance, contrast } from "./fsx-appearance-helpers";
import { fillSource, sourceText } from "./fsx-editor-helpers";

for (const colorScheme of ["light", "dark"] as const) {
	test(`focused caret and host/guest contrast with ${colorScheme} system preference`, async ({ page }) => {
		await page.emulateMedia({ colorScheme });
		await page.goto("?mode=fsx&demo=quote");
		const editor = page.getByRole("textbox", { name: "FSX source", exact: true });
		await editor.click();
		await fillSource(editor, '<Field label="Client" value={customer} />');
		await editor.press("End");
		await page.keyboard.type(" ");
		await expect(editor).toBeFocused();
		await expect(editor).toContainText("value={customer} /> ");
		const caret = page.locator(".cm-cursor");
		await expect(caret).toHaveCSS("border-left-width", "2px");
		const bounds = await caret.boundingBox();
		expect(bounds?.height).toBeGreaterThan(10);
		expect(bounds?.width).toBeGreaterThanOrEqual(2);
		const colors = await appearance(editor);
		expect(contrast(colors.caret, colors.background)).toBeGreaterThan(7);
		for (const kind of ["tag", "attribute", "string", "punctuation", "text"] as const) {
			expect(contrast(colors[kind], colors.background)).toBeGreaterThanOrEqual(4.5);
		}
		expect(new Set([colors.tag, colors.attribute, colors.string, colors.text].map(String)).size).toBe(4);
		await expect(editor.locator(".cm-fsx-string")).toHaveText('"Client"');
		await expect(editor.locator(".cm-fsx-attribute")).toHaveText(["label", "value"]);
		await expect(editor.locator('[class*="cm-fsx-"]').filter({ hasText: "customer" })).toHaveCount(0);
		await editor.press("ControlOrMeta+a");
		for (const focused of [true, false]) {
			if (!focused) await page.getByLabel("Initial JSON data", { exact: true }).focus();
			if (focused) await expect(editor).toBeFocused();
			else await expect(editor).not.toBeFocused();
			const selection = page.locator(".cm-selectionBackground").first();
			await expect(selection).toBeVisible();
			await expect(selection).toHaveCSS("background-color", "rgb(51, 65, 85)");
			const selected = await appearance(editor);
			expect(selected.selection).toEqual([51, 65, 85]);
			if (!selected.selection) throw new Error("Missing drawn selection");
			expect(contrast(selected.selection, selected.background)).toBeGreaterThan(1.5);
			for (const kind of ["tag", "attribute", "string", "punctuation", "text"] as const) {
				expect(contrast(selected[kind], selected.selection)).toBeGreaterThanOrEqual(4.5);
			}
		}
	});
}

test("larger responsive source area wraps and scrolls without squeezing the preview", async ({ page }, testInfo) => {
	await page.goto("?mode=fsx&demo=quote");
	const scroller = page.locator(".cm-scroller");
	const bounds = await scroller.boundingBox();
	expect(bounds?.height).toBeGreaterThanOrEqual(320);
	expect(bounds?.height).toBeLessThanOrEqual(448);
	if (testInfo.project.name === "chromium-desktop") expect(bounds?.height).toBe(448);
	const preview = page.locator(".fsx-workspace > section").last();
	if (testInfo.project.name === "chromium-desktop") {
		expect((await preview.boundingBox())?.width).toBeGreaterThanOrEqual(512);
		expect(bounds?.width).toBeGreaterThanOrEqual(500);
	}
	const editor = page.getByRole("textbox", { name: "FSX source", exact: true });
	const draft = `<Field label="${"long string ".repeat(100)}" />\n${"<Field />\n".repeat(100)}`;
	await fillSource(editor, draft);
	await expect.poll(() => scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
	await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
	expect(await scroller.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
	expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
	expect(await sourceText(editor)).toBe(draft);
	await page.getByRole("button", { name: "Reset example" }).click();
	await expect(editor.locator(".cm-fsx-tag").first()).toHaveText("Form");
});
