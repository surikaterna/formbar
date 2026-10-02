import { type Page, expect, test } from "@playwright/test";
import { fillSource, sourceText } from "./fsx-editor-helpers";

async function applyGroups(page: Page) {
	await page.goto("?mode=playground&demo=fsx-line-items");
	await page.getByLabel("Description", { exact: true }).first().fill("Retained work");
	const editor = page.getByLabel("FSX source", { exact: true });
	const source = (await sourceText(editor))
		.replace(/(<Field id="description"[^\n]+\/>)/, '<Group id="group-description" label="Work">$1</Group>')
		.replace(/(<Field id="amount"[^\n]+\/>)/, '<Group id="group-amount" label="Cost">$1</Group>');
	await fillSource(editor, source);
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	await expect(page.getByRole("list", { name: "Source diagnostics" })).toBeEmpty();
	await expect(page.getByLabel("Description", { exact: true }).first()).toHaveValue("Retained work");
	return source;
}

async function expectOwnedGeometry(page: Page) {
	const failures = await page.locator("form").evaluate((form) => {
		const errors: string[] = [];
		const children =
			"[data-formbar-node], [data-kalada-node], [data-kalada-control], [data-kalada-output], [data-kalada-action]";
		const overlaps = (a: Element, b: Element) => {
			const left = a.getBoundingClientRect();
			const right = b.getBoundingClientRect();
			return (
				Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1 &&
				Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1
			);
		};
		const owners = form.querySelectorAll("fieldset, section[data-formbar-node], [data-kalada-node]");
		for (const owner of owners) {
			const box = owner.getBoundingClientRect();
			const siblings = [...owner.children].filter((child) => child.matches(children));
			for (const child of [...siblings, ...owner.querySelectorAll("input, select, button, label, legend, output")]) {
				const rect = child.getBoundingClientRect();
				if (rect.left < box.left - 1 || rect.right > box.right + 1)
					errors.push(`outside ${owner.outerHTML.slice(0, 90)}`);
			}
			if (siblings.some((child, index) => siblings.slice(index + 1).some((sibling) => overlaps(child, sibling))))
				errors.push("overlapping siblings");
		}
		return errors;
	});
	expect(failures).toEqual([]);
}

test("compiled sibling Groups own their fields without overlap at narrow, tablet and desktop widths", async ({
	page,
}) => {
	await applyGroups(page);
	for (const width of [360, 768, 1280]) {
		await page.setViewportSize({ width, height: 1000 });
		await expectOwnedGeometry(page);
		const group = await page.locator('[data-formbar-node="group-description"]').first().boundingBox();
		const row = await page.getByRole("list", { name: "lines items" }).locator("li > fieldset").first().boundingBox();
		expect(group && row && group.width / row.width).toBeGreaterThan(0.9);
	}
});

test("nested Group and Conditional wrappers keep existing bound repeaters and outputs contained", async ({ page }) => {
	const source = await applyGroups(page);
	const editor = page.getByLabel("FSX source", { exact: true });
	await fillSource(
		editor,
		source
			.replace(
				'<Repeater id="lines"',
				'<Group id="outer"><Conditional id="branch" condition={true}><Repeater id="lines"',
			)
			.replace("</Repeater>", "</Repeater></Conditional></Group>")
			.replace(
				'<Group id="group-description" label="Work">',
				'<Group id="group-description" label="Work"><Conditional id="inner" condition={true}>',
			)
			.replace("</Group>", "</Conditional></Group>"),
	);
	await page.getByRole("button", { name: "Compile and Apply" }).click();
	await expect(page.getByRole("list", { name: "Source diagnostics" })).toBeEmpty();
	for (const width of [360, 768, 1280]) {
		await page.setViewportSize({ width, height: 1000 });
		await expectOwnedGeometry(page);
	}
	await page.getByLabel("Amount", { exact: true }).first().fill("25");
	await page.getByRole("button", { name: "Submit", exact: true }).click();
	await expect(page.getByRole("region", { name: "Last successful submission" })).toContainText("Retained work");
});

async function setSpans(page: Page, base: number, md: number) {
	// FSX has no span syntax; exercise the public renderer's emitted CSS-variable contract.
	await page.locator('[data-formbar-node="group-description"], [data-formbar-node="group-amount"]').evaluateAll(
		(groups, values) => {
			for (const group of groups) {
				(group as HTMLElement).style.setProperty("--formbar-span-base", String(values.base));
				(group as HTMLElement).style.setProperty("--formbar-span-md", String(values.md));
			}
		},
		{ base, md },
	);
}

test("structural child spans respect the renderer base/md API rather than forcing full width", async ({ page }) => {
	await applyGroups(page);
	for (const spans of [
		{ base: 12, md: 6 },
		{ base: 6, md: 12 },
	]) {
		await setSpans(page, spans.base, spans.md);
		for (const width of [360, 767, 768, 1280]) {
			await page.setViewportSize({ width, height: 1000 });
			const columns = await page
				.locator('[data-formbar-node="group-description"]')
				.first()
				.evaluate((group) => getComputedStyle(group).gridColumn);
			expect(columns).toContain(`span ${width < 768 ? spans.base : spans.md}`);
			await expectOwnedGeometry(page);
			const fieldColumns = await page
				.locator('[data-kalada-control="description"]')
				.first()
				.evaluate((field) => getComputedStyle(field).gridColumn);
			expect(fieldColumns).toContain("span 12");
		}
	}
});
