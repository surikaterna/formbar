// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { orderEntryDemo } from "../demos/14-order-entry";
import { arbiterCalculatedDemo } from "../demos/19-arbiter-calculated";
import { button, cleanupDemos, click, labelled, mountDemo, setInput } from "./extension-demo-test-utils";

afterEach(cleanupDemos);

function output(view: Awaited<ReturnType<typeof mountDemo>>, label: string): string | undefined {
	const target = [...view.container.querySelectorAll("output")].find((candidate) => {
		const labelId = candidate.getAttribute("aria-labelledby") ?? "";
		return document.getElementById(labelId)?.textContent === label;
	});
	return target?.textContent ?? undefined;
}

function repeatedInput(view: Awaited<ReturnType<typeof mountDemo>>, label: string, index: number): HTMLInputElement {
	const controls = [...view.container.querySelectorAll("label")]
		.filter((candidate) => candidate.textContent?.trim() === label)
		.map((candidate) => document.getElementById(candidate.htmlFor))
		.filter((candidate): candidate is HTMLInputElement => candidate instanceof HTMLInputElement);
	const control = controls[index];
	if (!control) throw new Error(`Missing ${label} ${index}`);
	return control;
}

describe("pure calculated outputs", () => {
	it("transitions demo 19 from small to bulk without stored arithmetic", async () => {
		const view = await mountDemo(arbiterCalculatedDemo, undefined, true);
		expect(output(view, "Tier")).toBe("small");
		expect(output(view, "Subtotal")).toBe("$25.00");
		expect(output(view, "Bulk Discount (10%)")).toBeUndefined();
		expect(output(view, "Total")).toBe("$25.00");
		setInput(labelled(view, "Quantity") as HTMLInputElement, "9");
		expect(output(view, "Subtotal")).toBe("$225.00");
		setInput(labelled(view, "Quantity") as HTMLInputElement, "10");
		expect(output(view, "Tier")).toBe("bulk");
		expect(output(view, "Subtotal")).toBe("$250.00");
		expect(output(view, "Bulk Discount (10%)")).toBe("$25.00");
		expect(output(view, "Total")).toBe("$225.00");
		setInput(labelled(view, "Quantity") as HTMLInputElement, "1");
		expect(output(view, "Tier")).toBe("small");
		expect(output(view, "Bulk Discount (10%)")).toBeUndefined();
	});

	it("reacts demo 14 totals to append, edit, move, remove, and reset", async () => {
		const view = await mountDemo(orderEntryDemo);
		expect(output(view, "Subtotal")).toBe("0");
		await click(button(view, "Add Line Item"));
		setInput(repeatedInput(view, "Description", 0), "First");
		setInput(repeatedInput(view, "Amount", 0), "100");
		setInput(labelled(view, "Tax Rate (%)") as HTMLInputElement, "10");
		setInput(labelled(view, "Discount (%)") as HTMLInputElement, "5");
		setInput(labelled(view, "Shipping Cost") as HTMLInputElement, "10");
		expect([
			output(view, "Subtotal"),
			output(view, "Tax Amount"),
			output(view, "Discount Amount"),
			output(view, "Total"),
		]).toEqual(["100", "10", "5", "115"]);
		await click(button(view, "Add Line Item"));
		setInput(repeatedInput(view, "Description", 1), "Second");
		setInput(repeatedInput(view, "Amount", 1), "50");
		expect(output(view, "Total")).toBe("167.5");
		await click(button(view, "Move up, item 2"));
		expect(output(view, "Total")).toBe("167.5");
		await click(button(view, "Remove, item 2"));
		expect(output(view, "Total")).toBe("62.5");
		await click(button(view, "Reset"));
		expect(output(view, "Subtotal")).toBe("0");
		expect(output(view, "Total")).toBe("0");
		expect(view.container.textContent).toContain("omitted from submission pending #129");
	});
});
