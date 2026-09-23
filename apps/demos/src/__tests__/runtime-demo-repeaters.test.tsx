// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { arrayItemsDemo } from "../demos/08-array-items";
import { orderEntryDemo } from "../demos/14-order-entry";
import {
	button,
	cleanupDemos,
	click,
	labelled,
	mountDemo,
	resultJson,
	setInput,
	setSelect,
} from "./extension-demo-test-utils";

afterEach(cleanupDemos);

function inputs(view: Awaited<ReturnType<typeof mountDemo>>, label: string): HTMLInputElement[] {
	return [...view.container.querySelectorAll("label")]
		.filter((candidate) => candidate.textContent?.trim() === label)
		.map((candidate) => document.getElementById(candidate.htmlFor))
		.filter((candidate): candidate is HTMLInputElement => candidate instanceof HTMLInputElement);
}

function selects(view: Awaited<ReturnType<typeof mountDemo>>, label: string): HTMLSelectElement[] {
	return [...view.container.querySelectorAll("label")]
		.filter((candidate) => candidate.textContent?.trim() === label)
		.map((candidate) => document.getElementById(candidate.htmlFor))
		.filter((candidate): candidate is HTMLSelectElement => candidate instanceof HTMLSelectElement);
}

function repeaterButton(view: Awaited<ReturnType<typeof mountDemo>>, id: string, label: string): HTMLButtonElement {
	const found = view.container.querySelector<HTMLButtonElement>(
		`[data-formbar-node="${id}"] button[aria-label="${label}"]`,
	);
	if (!found) throw new Error(`Missing ${id} ${label}`);
	return found;
}

describe("array demo repeaters", () => {
	it("adds, edits, moves, removes, enforces tag constraints, and submits core arrays", async () => {
		const submitted = vi.fn();
		const view = await mountDemo(arrayItemsDemo, submitted, true);
		setInput(labelled(view, "Project Name") as HTMLInputElement, "Runtime migration");
		await click(button(view, "Add Tags"));
		await click(button(view, "Add Tags"));
		expect(selects(view, "Tag")).toHaveLength(2);
		expect(document.activeElement).toBe(selects(view, "Tag")[1]);
		expect(button(view, "Add Tags").disabled).toBe(true);
		setSelect(selects(view, "Tag")[0], "option-1");
		setSelect(selects(view, "Tag")[1], "option-1");
		await click(button(view, "Submit"));
		expect(submitted).not.toHaveBeenCalled();
		expect(view.container.querySelector("[data-formbar-error-summary]")?.textContent).toContain("uniqueItems");
		setSelect(selects(view, "Tag")[1], "option-2");
		await click(button(view, "Add Team Members"));
		await click(button(view, "Add Team Members"));
		expect(document.activeElement).toBe(inputs(view, "Name")[1]);
		for (const [index, name] of ["Ada", "Grace"].entries()) setInput(inputs(view, "Name")[index], name);
		await click(repeaterButton(view, "team-members", "Move up, item 2"));
		expect(inputs(view, "Name").map((control) => control.value)).toEqual(["Grace", "Ada"]);
		await click(repeaterButton(view, "team-members", "Remove, item 2"));
		expect(inputs(view, "Name").map((control) => control.value)).toEqual(["Grace"]);
		await click(button(view, "Submit"));
		expect(submitted).toHaveBeenCalledOnce();
		expect(JSON.parse(resultJson(view) ?? "")).toMatchObject({
			projectName: "Runtime migration",
			tags: ["frontend", "backend"],
			teamMembers: [{ name: "Grace" }],
		});
	});
});

describe("order line-item repeater", () => {
	it("uses date controls, nested validation, focus-safe operations, and payloads without totals", async () => {
		const submitted = vi.fn();
		const view = await mountDemo(orderEntryDemo, submitted);
		expect((labelled(view, "Order Date") as HTMLInputElement).type).toBe("date");
		expect((labelled(view, "Requested Delivery Date") as HTMLInputElement).type).toBe("date");
		await click(button(view, "Add Line Item"));
		expect(document.activeElement).toBe(inputs(view, "Description")[0]);
		expect(button(view, "Remove, item 1").disabled).toBe(true);
		await click(button(view, "Submit"));
		expect(submitted).not.toHaveBeenCalled();
		expect(view.container.querySelector("[data-formbar-error-summary]")?.textContent).toContain("Required property");
		setInput(labelled(view, "Customer Name") as HTMLInputElement, "Customer");
		setInput(labelled(view, "Order Date") as HTMLInputElement, "2026-09-23");
		setSelect(labelled(view, "Payment Method") as HTMLSelectElement, "option-0");
		setInput(inputs(view, "Description")[0], "Consulting");
		setInput(inputs(view, "Amount")[0], "100");
		await click(button(view, "Add Line Item"));
		setInput(inputs(view, "Description")[1], "Support");
		setInput(inputs(view, "Amount")[1], "50");
		await click(button(view, "Move up, item 2"));
		expect(inputs(view, "Description").map((control) => control.value)).toEqual(["Support", "Consulting"]);
		await click(button(view, "Submit"));
		expect(submitted).toHaveBeenCalledOnce();
		const payload = JSON.parse(resultJson(view) ?? "");
		expect(payload.lineItems).toEqual([
			{ description: "Support", amount: 50 },
			{ description: "Consulting", amount: 100 },
		]);
		for (const key of ["subtotal", "taxAmount", "discountAmount", "total"]) expect(payload).not.toHaveProperty(key);
		expect(Object.keys(payload).some((key) => key.includes("formbar"))).toBe(false);
	});
});
