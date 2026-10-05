import { expect, test } from "@playwright/test";
import { fillSource } from "./fsx-editor-helpers";

test("host styles update without styling guests or retaining stale reset decorations", async ({ page }) => {
	await page.goto("?mode=fsx&demo=quote");
	const editor = page.getByRole("textbox", { name: "FSX source", exact: true });
	await expect(editor.locator(".cm-fsx-tag").first()).toHaveText("Form");
	const source = '<Root a="😀">\r\n<Field value={"}"} />\r\n</Root>';
	await fillSource(editor, source);
	await expect(editor.locator(".cm-fsx-tag")).toHaveText(["Root", "Field", "Root"]);
	await expect(editor.locator(".cm-fsx-string")).toHaveText(['"😀"']);
	await expect(editor.locator(".cm-fsx-attribute")).toHaveText(["a", "value"]);
	await fillSource(editor, '<Field value={"} <Pretend a=foo />');
	await expect(editor.locator(".cm-fsx-tag")).toHaveText(["Field"]);
	await expect(editor.locator(".cm-fsx-string")).toHaveCount(0);
	await fillSource(editor, "<");
	await expect(editor.locator(".cm-fsx-tag")).toHaveCount(0);
	await page.getByRole("button", { name: "Reset example" }).click();
	await expect(editor.locator(".cm-fsx-tag").first()).toHaveText("Form");
});
