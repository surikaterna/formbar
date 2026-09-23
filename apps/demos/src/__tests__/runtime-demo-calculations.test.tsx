// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { orderEntryDemo } from "../demos/14-order-entry";
import { arbiterCalculatedDemo, arbiterCalculatedSchema } from "../demos/19-arbiter-calculated";
import { createJsonSchemaValidator } from "../validation/json-schema-validator";
import { button, cleanupDemos, click, labelled, mountDemo, resultJson, setInput } from "./extension-demo-test-utils";

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

async function directSubmit(view: Awaited<ReturnType<typeof mountDemo>>) {
	await act(async () => {
		view.container.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
		await Promise.resolve();
	});
}

describe("pure calculated outputs", () => {
	it("keeps native price validity separate from permissive schema submission and projected USD outputs", async () => {
		const submitted = vi.fn();
		const view = await mountDemo(arbiterCalculatedDemo, submitted, true);
		const price = labelled(view, "Unit Price ($)") as HTMLInputElement;
		const quantity = labelled(view, "Quantity") as HTMLInputElement;
		const validate = createJsonSchemaValidator(arbiterCalculatedSchema);
		expect([price.type, price.min, price.step, quantity.min]).toEqual(["number", "0", "0.01", "1"]);
		expect(view.container.querySelector("form")?.noValidate).toBe(true);
		expect(view.container.querySelector("button")).toBeNull();
		setInput(price, "-1");
		expect(price.validity.rangeUnderflow).toBe(true);
		expect(validate({ data: { quantity: 1, unitPrice: -1 }, uiState: {} })).toEqual([]);
		expect(output(view, "Subtotal")).toBe("-$1.00");
		await directSubmit(view);
		expect(submitted).toHaveBeenCalledWith({ quantity: 1, unitPrice: -1 });
		setInput(price, "0.001");
		expect(price.validity.stepMismatch).toBe(true);
		expect(validate({ data: { quantity: 1, unitPrice: 0.001 }, uiState: {} })).toEqual([]);
		await directSubmit(view);
		expect(submitted).toHaveBeenLastCalledWith({ quantity: 1, unitPrice: 0.001 });
	});

	it("preserves decimal price payloads, blocks quantity zero, and remounts with cent presentation", async () => {
		const submitted = vi.fn();
		const view = await mountDemo(arbiterCalculatedDemo, submitted, true);
		const price = labelled(view, "Unit Price ($)") as HTMLInputElement;
		const quantity = labelled(view, "Quantity") as HTMLInputElement;
		const validate = createJsonSchemaValidator(arbiterCalculatedSchema);
		setInput(price, "25.01");
		expect(output(view, "Subtotal")).toBe("$25.01");
		await directSubmit(view);
		expect(submitted).toHaveBeenLastCalledWith({ quantity: 1, unitPrice: 25.01 });
		const successful = resultJson(view);
		expect(JSON.parse(successful ?? "")).toEqual({ quantity: 1, unitPrice: 25.01 });
		setInput(quantity, "0");
		expect(validate({ data: { quantity: 0, unitPrice: 25.01 }, uiState: {} })).toMatchObject([
			{ code: "json-schema.minimum", path: { segments: ["quantity"] } },
		]);
		await directSubmit(view);
		expect(submitted).toHaveBeenCalledTimes(1);
		expect(resultJson(view)).toBe(successful);
		setInput(quantity, "10");
		setInput(price, "0.29");
		expect([output(view, "Subtotal"), output(view, "Bulk Discount (10%)"), output(view, "Total")]).toEqual([
			"$2.90",
			"$0.29",
			"$2.61",
		]);
		await directSubmit(view);
		expect(submitted).toHaveBeenLastCalledWith({ quantity: 10, unitPrice: 0.29 });
		const remount = await mountDemo(arbiterCalculatedDemo, undefined, true);
		expect((labelled(remount, "Unit Price ($)") as HTMLInputElement).step).toBe("0.01");
		expect(output(remount, "Subtotal")).toBe("$25.00");
	});

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
