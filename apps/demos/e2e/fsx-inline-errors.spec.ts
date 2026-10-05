import { type Locator, type Page, expect, test } from "@playwright/test";
import { fillSource, sourceSelection, sourceText } from "./fsx-editor-helpers";

async function gutterFailure(page: Page) {
	await page.goto("?mode=fsx&demo=quote");
	const editor = page.getByRole("textbox", { name: "FSX source", exact: true });
	const original = await sourceText(editor);
	await fillSource(editor, original.replace("value={name}", "value={missing}"));
	await page.getByRole("button", { name: "Compile and Apply", exact: true }).click();
	const marker = page.locator(".cm-lint-marker-error").first();
	await expect(marker).toBeVisible();
	return { editor, original, marker, tooltip: page.locator(".cm-tooltip-lint") };
}

async function expectNoExpiredGutter(page: Page) {
	await expect(page.getByRole("list", { name: "Source diagnostics" })).toBeEmpty();
	await expect(page.locator(".cm-lintRange-error, .cm-lint-marker-error")).toHaveCount(0);
	// Keep the pointer fixed past the gutter's hover delay to detect late resurrection.
	await page.waitForTimeout(700);
	await expect(page.locator(".cm-tooltip-lint")).toHaveCount(0);
}

test("gutter content is hoverable across pointer transfer and dismisses after leaving both", async ({ page }) => {
	const { marker, tooltip } = await gutterFailure(page);
	await marker.hover();
	await expect(tooltip).toBeVisible();
	await tooltip.hover();
	await page.waitForTimeout(700);
	await expect(tooltip).toBeVisible();
	await page.getByRole("heading", { name: "Interactive playground", exact: true }).hover();
	await expect(tooltip).toHaveCount(0);
});

test("gutter invalidation while pointer rests on content clears immediately and stays cleared", async ({ page }) => {
	const { marker, tooltip } = await gutterFailure(page);
	await marker.hover();
	await expect(tooltip).toBeVisible();
	await tooltip.hover();
	await page.waitForTimeout(700);
	await expect(tooltip).toBeVisible();
	await page.getByLabel("Initial JSON data", { exact: true }).fill("{}");
	await expect(tooltip).toHaveCount(0);
	await expectNoExpiredGutter(page);
});

test("Escape dismisses hovered gutter content while focus stays outside the editor", async ({ page }) => {
	const { marker, tooltip } = await gutterFailure(page);
	const apply = page.getByRole("button", { name: "Compile and Apply", exact: true });
	await apply.focus();
	await expect(apply).toBeFocused();
	await marker.hover();
	await expect(tooltip).toBeVisible();
	await tooltip.hover();
	await page.waitForTimeout(700);
	await expect(tooltip).toBeVisible();
	await page.keyboard.press("Escape");
	await page.waitForTimeout(700);
	await expect(tooltip).toHaveCount(0);
	await expect(apply).toBeFocused();
	await marker.hover();
	await expect(tooltip).toBeVisible();
});

test("gutter keyboard focus retains content and Escape dismisses until a new interaction", async ({ page }) => {
	const { marker, tooltip } = await gutterFailure(page);
	await marker.focus();
	await expect(tooltip).toBeVisible();
	await tooltip.focus();
	await page.waitForTimeout(700);
	await expect(tooltip).toBeVisible();
	await page.keyboard.press("Escape");
	await page.waitForTimeout(700);
	await expect(tooltip).toHaveCount(0);
	await marker.focus();
	await expect(tooltip).toBeVisible();
	await marker.hover();
	await page.keyboard.press("Escape");
	await page.waitForTimeout(700);
	await expect(tooltip).toHaveCount(0);
	await marker.focus();
	await expect(tooltip).toHaveCount(0);
	await page.getByRole("heading", { name: "Interactive playground", exact: true }).hover();
	await marker.hover();
	await expect(tooltip).toBeVisible();
});

test("active gutter tooltip expires on JSON edit without pointer movement", async ({ page }) => {
	const { marker, tooltip } = await gutterFailure(page);
	await marker.hover();
	await expect(tooltip).toContainText("missing");
	await page.getByLabel("Initial JSON data", { exact: true }).fill("{}");
	await expectNoExpiredGutter(page);
});

test("pending gutter tooltip cannot resurrect after a source transaction", async ({ page }) => {
	const { editor, marker, tooltip } = await gutterFailure(page);
	await marker.hover();
	await expect(tooltip).toHaveCount(0);
	await editor.focus();
	await editor.press("End");
	await editor.press("Space");
	await expectNoExpiredGutter(page);
});

test("Reset clears an active gutter tooltip with the pointer fixed", async ({ page }) => {
	const { marker, tooltip } = await gutterFailure(page);
	await marker.hover();
	await expect(tooltip).toContainText("missing");
	await page
		.getByRole("button", { name: "Reset example", exact: true })
		.evaluate((button: HTMLButtonElement) => button.click());
	await expectNoExpiredGutter(page);
});

test("new Apply report replaces old gutter hover and fresh markers show only current messages", async ({ page }) => {
	const { editor, marker, tooltip } = await gutterFailure(page);
	await marker.hover();
	await expect(tooltip).toContainText("missing");
	const oldMessage = await tooltip.textContent();
	if (!oldMessage) throw new Error("Missing old gutter tooltip message");
	await fillSource(
		editor,
		'<Form id="quote" defaultLanguage="Kalada">\n<Field id="current" widget="text" value={name}/><Field id="current" widget="text" value={name}/></Form>',
	);
	// A DOM click applies without moving the pointer off the old gutter location.
	await page
		.getByRole("button", { name: "Compile and Apply", exact: true })
		.evaluate((button: HTMLButtonElement) => button.click());
	await page.waitForTimeout(700);
	await expect(tooltip.filter({ hasText: oldMessage })).toHaveCount(0);
	await page.locator(".cm-lint-marker-error").hover();
	await expect(tooltip).toContainText('ID "current" is already used');
	await expect(tooltip).not.toContainText(oldMessage);
	await page.locator(".cm-lint-marker-error").focus();
	await expect(tooltip).toContainText('ID "current" is already used');
});

async function applyDraft(page: Page, editor: Locator, desktop: boolean) {
	// Android CodeMirror defers native modified Enter; existing desktop tests own hardware shortcuts.
	if (desktop) await editor.press("Control+Enter");
	else await page.getByRole("button", { name: "Compile and Apply", exact: true }).click();
}

test("Apply-only inline errors retain preview, safely hover, select, clear and reapply", async ({ page }, testInfo) => {
	await page.goto("?mode=fsx&demo=quote");
	const editor = page.getByRole("textbox", { name: "FSX source", exact: true });
	const original = await sourceText(editor);
	const invalid = original.replace("value={name}", "value={missing}");
	await fillSource(editor, invalid);
	await expect(page.locator(".cm-lintRange-error")).toHaveCount(0);
	await page.getByRole("button", { name: "Compile and Apply", exact: true }).click();
	const list = page.getByRole("list", { name: "Source diagnostics" });
	const message = await list.getByRole("button").first().textContent();
	expect(message).toBeTruthy();
	const mark = page.locator(".cm-lintRange-error").first();
	await expect(mark).toHaveText("missing");
	await expect(page.locator(".cm-lint-marker-error").first()).toBeVisible();
	await mark.hover();
	await expect(page.locator(".cm-tooltip-lint")).toContainText(message ?? "");
	await expect(page.locator(".cm-tooltip-lint")).toHaveCSS("color", "rgb(248, 250, 252)");
	await list.getByRole("button").first().click();
	await expect(editor).toBeFocused();
	expect(await sourceSelection(editor)).toEqual([invalid.indexOf("missing"), invalid.indexOf("missing") + 7]);
	await expect(page.getByLabel("Customer", { exact: true })).toHaveValue("Ada");
	await expect(page.getByText("Preview: applied revision 1.", { exact: false })).toBeVisible();
	await editor.press("End");
	await editor.press("Space");
	await expect(mark).toHaveCount(0);
	await editor.press("ControlOrMeta+z");
	await expect(mark).toHaveCount(0);
	await applyDraft(page, editor, testInfo.project.name === "chromium-desktop");
	await expect(mark).toHaveText("missing");
	await page.getByLabel("Initial JSON data", { exact: true }).fill("{}");
	await expect(mark).toHaveCount(0);
	await page.getByRole("button", { name: "Reset example", exact: true }).click();
	await expect(list.getByRole("button")).toHaveCount(0);
});

test("fresh ranges and successful Apply clear lint; invalid JSON stays list-only", async ({ page }, testInfo) => {
	await page.goto("?mode=fsx&demo=quote");
	const editor = page.getByRole("textbox", { name: "FSX source", exact: true });
	const original = await sourceText(editor);
	await fillSource(editor, original.replace("value={quantity}", "value={unknownQuantity}"));
	await applyDraft(page, editor, testInfo.project.name === "chromium-desktop");
	await expect(page.locator(".cm-lintRange-error")).toHaveText("unknownQuantity");
	await fillSource(editor, original);
	await applyDraft(page, editor, testInfo.project.name === "chromium-desktop");
	await expect(page.locator(".cm-lintRange-error")).toHaveCount(0);
	await expect(page.getByText("Preview: applied revision 2.", { exact: false })).toBeVisible();
	await page.getByLabel("Initial JSON data", { exact: true }).fill("{");
	await page.getByRole("button", { name: "Compile and Apply", exact: true }).click();
	const list = page.getByRole("list", { name: "Source diagnostics" });
	await expect(list.getByRole("button")).toBeDisabled();
	await list.getByText("Diagnostic details").click();
	await expect(list).toContainText("initialData/installation");
	await expect(page.locator(".cm-lintRange-error, .cm-lintPoint-error, .cm-lint-marker-error")).toHaveCount(0);
	await expect(page.getByLabel("Customer", { exact: true })).toHaveValue("Ada");
});

test("compiler hover treats markup as text and keeps related locations list-only", async ({ page }) => {
	await page.goto("?mode=fsx&demo=quote");
	const editor = page.getByRole("textbox", { name: "FSX source", exact: true });
	const source =
		'<Form id="quote" defaultLanguage="Kalada">\n<Field id="<img src=x>" widget="text" value={name}/><Field id="<img src=x>" widget="text" value={name}/></Form>';
	await fillSource(editor, source);
	await page.getByRole("button", { name: "Compile and Apply", exact: true }).click();
	const list = page.getByRole("list", { name: "Source diagnostics" });
	await list.getByRole("button").first().click();
	await expect(page.locator(".cm-lintRange-error")).toHaveCount(1);
	await page.locator(".cm-lintRange-error").hover();
	const tooltip = page.locator(".cm-tooltip-lint");
	await expect(tooltip).toContainText('ID "<img src=x>" is already used');
	await expect(tooltip.locator("img")).toHaveCount(0);
	await expect(list.locator("img")).toHaveCount(0);
	await list.getByRole("button", { name: "First declared on <Field> here." }).click();
	expect(await sourceSelection(editor)).toEqual([
		source.indexOf('"<img src=x>"'),
		source.indexOf('"<img src=x>"') + 13,
	]);
});
