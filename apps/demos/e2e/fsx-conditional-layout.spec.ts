import { writeFile } from "node:fs/promises";
import { type Page, type TestInfo, expect, test } from "@playwright/test";
import { fillSource, sourceText } from "./fsx-editor-helpers";

async function applyConditional(page: Page, insideGroup: boolean) {
	await page.goto("?mode=playground&demo=fsx-line-items");
	const editor = page.getByLabel("FSX source", { exact: true });
	const conditional = '<Conditional id="conditional" condition={true}>$1</Conditional>';
	const source = (await sourceText(editor)).replace(
		/(<Field id="description"[^\n]+\/>\s*<Field id="amount"[^\n]+\/>)/,
		insideGroup ? `<Group id="work">${conditional}</Group>` : conditional,
	);
	await fillSource(editor, source);
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	await expect(page.getByRole("list", { name: "Source diagnostics" })).toBeEmpty();
	await expect(page.getByLabel("Description", { exact: true }).first()).toHaveValue("Design");
}

async function conditionalGeometry(page: Page) {
	return page
		.locator('[data-kalada-node="conditional"]')
		.first()
		.evaluate((owner) => {
			const box = (element: Element) => {
				const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
				return { x, y, width, height, right, bottom };
			};
			return {
				html: owner.outerHTML,
				display: getComputedStyle(owner).display,
				column: getComputedStyle(owner).gridColumn,
				minWidth: getComputedStyle(owner).minWidth,
				tracks: getComputedStyle(owner).gridTemplateColumns.split(" ").length,
				owner: box(owner),
				children: [...owner.children].map((child) => ({
					box: box(child),
					column: getComputedStyle(child).gridColumn,
					minWidth: getComputedStyle(child).minWidth,
					input: box(child.querySelector("input") as HTMLInputElement),
				})),
			};
		});
}

function expectGeometry(geometry: Awaited<ReturnType<typeof conditionalGeometry>>, span: number) {
	expect(geometry.display).toBe("grid");
	expect(geometry.tracks).toBe(12);
	expect(geometry.children).toHaveLength(2);
	for (const child of geometry.children) {
		expect(child.column).toContain(`span ${span}`);
		expect(child.minWidth).toBe("0px");
		expect(child.box.x).toBeGreaterThanOrEqual(geometry.owner.x - 1);
		expect(child.box.right).toBeLessThanOrEqual(geometry.owner.right + 1);
		expect(child.box.width / geometry.owner.width).toBeGreaterThan(span === 6 ? 0.4 : 0.9);
		expect(child.box.width / geometry.owner.width).toBeLessThanOrEqual(span === 6 ? 0.51 : 1.01);
		expect(child.input.x).toBeGreaterThanOrEqual(child.box.x - 1);
		expect(child.input.right).toBeLessThanOrEqual(child.box.right + 1);
	}
	const [left, right] = geometry.children;
	expect(left.box.right <= right.box.x + 1 || left.box.bottom <= right.box.y + 1).toBe(true);
}

async function recordGeometry(page: Page, testInfo: TestInfo, name: string) {
	const geometry = await conditionalGeometry(page);
	const path = testInfo.outputPath(`${name}.json`);
	await writeFile(path, JSON.stringify(geometry, null, 2));
	await testInfo.attach(name, { path, contentType: "application/json" });
	await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
	return geometry;
}

async function expectResponsiveConditional(page: Page, testInfo: TestInfo) {
	// FSX has no span grammar: use the emitted renderer CSS-variable API.
	await page.locator('[data-kalada-node="conditional"]').evaluateAll((owners) => {
		for (const owner of owners) {
			(owner as HTMLElement).style.setProperty("--formbar-span-base", "6");
			(owner as HTMLElement).style.setProperty("--formbar-span-md", "12");
		}
	});
	for (const width of [360, 768, 1280]) {
		await page.setViewportSize({ width, height: 1000 });
		const geometry = await recordGeometry(page, testInfo, `default-${width}`);
		expect(geometry.column).toContain(`span ${width < 768 ? 6 : 12}`);
		expect(geometry.minWidth).toBe("0px");
		expectGeometry(geometry, 12);
	}
	await page.locator('[data-kalada-node="conditional"] > [data-kalada-control]').evaluateAll((children) => {
		for (const child of children) {
			(child as HTMLElement).style.setProperty("--formbar-span-base", "12");
			(child as HTMLElement).style.setProperty("--formbar-span-md", "6");
		}
	});
	for (const width of [360, 768, 1280]) {
		await page.setViewportSize({ width, height: 1000 });
		const geometry = await recordGeometry(page, testInfo, `spans-${width}`);
		expectGeometry(geometry, width < 768 ? 12 : 6);
	}
}

for (const insideGroup of [false, true]) {
	test(`compiled conditional ${insideGroup ? "inside Group" : "inside Repeater"} owns responsive child spans`, async ({
		page,
	}, testInfo) => {
		await applyConditional(page, insideGroup);
		await expectResponsiveConditional(page, testInfo);
	});
}
