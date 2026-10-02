import { type Page, expect, test } from "@playwright/test";
import { fillSource, sourceText } from "./fsx-editor-helpers";

async function expectComfortableRows(page: Page) {
	const preview = page.getByRole("region", { name: "Running preview", exact: true });
	await expect(preview.locator("form")).toHaveCount(1);
	const geometry = await preview.evaluate((element) => {
		const box = element.getBoundingClientRect();
		const controls = [...element.querySelectorAll("input, select, button")];
		return {
			width: box.width,
			overflow: document.body.scrollWidth - window.innerWidth,
			mainOverflow:
				(document.querySelector("main")?.scrollWidth ?? 0) - (document.querySelector("main")?.clientWidth ?? 0),
			contained: controls.every((control) => {
				const rect = control.getBoundingClientRect();
				const minimum = control.tagName === "BUTTON" ? 44 : 120;
				return rect.left >= box.left && rect.right <= box.right + 1 && rect.width >= minimum;
			}),
			inputRatios: [...element.querySelectorAll("input")].map(
				(input) =>
					input.getBoundingClientRect().width / (input.closest("fieldset")?.getBoundingClientRect().width ?? 1),
			),
		};
	});
	expect(geometry.width).toBeGreaterThanOrEqual(328);
	expect(geometry.overflow).toBeLessThanOrEqual(1);
	expect(geometry.mainOverflow).toBeLessThanOrEqual(1);
	expect(geometry.contained).toBe(true);
	for (const ratio of geometry.inputRatios) expect(ratio).toBeGreaterThan(0.85);
}

for (const mode of ["demo", "playground"]) {
	test(`FSX ${mode} rows use their container across shell breakpoints`, async ({ page }) => {
		await page.goto(`?mode=${mode}&demo=fsx-line-items`);
		await expect(page.getByLabel("Description", { exact: true }).first()).toHaveValue("Design");
		for (const width of [360, 390, 767, 768, 1023, 1024, 1279, 1280, 1440]) {
			await page.setViewportSize({ width, height: 1000 });
			await expectComfortableRows(page);
			if (mode === "demo") {
				const sources = page.getByRole("region", { name: "FSX sources", exact: true });
				const preview = page.getByRole("region", { name: "Running preview", exact: true });
				expect((await preview.boundingBox())?.width).toBe((await sources.boundingBox())?.width);
			}
		}
	});
}

test("Demo source summary stays collapsed and opening it preserves native edits", async ({ page }) => {
	await page.goto("?mode=demo&demo=fsx-line-items");
	const summary = page.getByText("Source and initial JSON", { exact: true });
	await expect(summary.locator("..")).not.toHaveAttribute("open");
	const description = page.getByLabel("Description", { exact: true }).first();
	await description.fill("Draft description");
	await summary.focus();
	await page.keyboard.press("Enter");
	await expect(summary.locator("..")).toHaveAttribute("open");
	await expect(description).toHaveValue("Draft description");
	await expectComfortableRows(page);
	await page.keyboard.press("Enter");
	await expect(summary.locator("..")).not.toHaveAttribute("open");
	await description.focus();
	await page.keyboard.press("Tab");
	await expect(page.getByLabel("Amount", { exact: true }).first()).toBeFocused();
});

test("Line-item source Apply preserves draft and keyboard actions remain usable", async ({ page }) => {
	await page.goto("?mode=playground&demo=fsx-line-items");
	await page.getByLabel("Description", { exact: true }).first().fill("Draft description");
	const editor = page.getByLabel("FSX source", { exact: true });
	await fillSource(editor, (await sourceText(editor)).replace('label="Description"', 'label="Work"'));
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	await expect(page.getByLabel("Work", { exact: true }).first()).toHaveValue("Draft description");
	const move = page.getByRole("button", { name: "Move row" }).first();
	await move.locator("..").getByRole("combobox").selectOption({ index: 2 });
	await move.focus();
	await page.keyboard.press("Enter");
	await expect(page.getByLabel("Work", { exact: true }).nth(1)).toHaveValue("Draft description");
	await page.getByRole("button", { name: "Remove", exact: true }).first().focus();
	await page.keyboard.press("Enter");
	await expect(page.getByLabel("Work", { exact: true })).toHaveCount(1);
	await page.getByRole("button", { name: "Submit", exact: true }).click();
	await expect(page.getByRole("region", { name: "Last successful submission" })).toContainText("Draft description");
	await page.getByRole("button", { name: "Reset example" }).click();
	await expect(page.getByLabel("Description", { exact: true }).first()).toHaveValue("Design");
});
