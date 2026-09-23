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

function choices(view: Awaited<ReturnType<typeof mountDemo>>, label: string): HTMLInputElement[] {
	return [...view.container.querySelectorAll("label")]
		.filter((candidate) => candidate.textContent?.trim() === label)
		.map((candidate) => document.getElementById(candidate.htmlFor))
		.filter((candidate): candidate is HTMLInputElement => candidate instanceof HTMLInputElement);
}

function choiceLabels(control: Element): string[] {
	return [...control.querySelectorAll("label")].map((label) => label.textContent?.trim() ?? "");
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
		const tagControls = [...view.container.querySelectorAll('[data-formbar-node="f-tag"] [data-widget]')];
		expect(tagControls).toHaveLength(2);
		for (const control of tagControls) expect(choiceLabels(control)).toEqual(["Front end", "Back end"]);
		expect(choices(view, "Front end")).toHaveLength(2);
		expect(choices(view, "Back end")).toHaveLength(2);
		expect(choices(view, "Back end").every((choice) => choice.disabled)).toBe(true);
		expect(document.activeElement).toBe(choices(view, "Front end")[1]);
		expect(button(view, "Add Tags").disabled).toBe(true);
		await click(choices(view, "Back end")[0]);
		expect(choices(view, "Back end")[0].checked).toBe(false);
		await click(choices(view, "Front end")[0]);
		await click(choices(view, "Front end")[1]);
		await click(button(view, "Submit"));
		expect(submitted).not.toHaveBeenCalled();
		expect(view.container.querySelector("[data-formbar-error-summary]")?.textContent).toContain("uniqueItems");
		await click(repeaterButton(view, "tags", "Remove, item 2"));
		await click(button(view, "Add Team Members"));
		await click(button(view, "Add Team Members"));
		expect(document.activeElement).toBe(inputs(view, "Name")[1]);
		for (const [index, name] of ["Ada", "Grace"].entries()) setInput(inputs(view, "Name")[index], name);
		const roleControls = [...view.container.querySelectorAll('[data-formbar-node="f-member-role"] [data-widget]')];
		expect(roleControls).toHaveLength(2);
		for (const control of roleControls) {
			expect(choiceLabels(control)).toEqual(["Team lead", "Developer", "Designer", "Quality assurance"]);
		}
		await click(choices(view, "Developer")[0]);
		await click(choices(view, "Quality assurance")[1]);
		await click(repeaterButton(view, "team-members", "Move up, item 2"));
		expect(inputs(view, "Name").map((control) => control.value)).toEqual(["Grace", "Ada"]);
		await click(repeaterButton(view, "team-members", "Remove, item 2"));
		expect(inputs(view, "Name").map((control) => control.value)).toEqual(["Grace"]);
		await click(button(view, "Submit"));
		expect(submitted).toHaveBeenCalledOnce();
		expect(JSON.parse(resultJson(view) ?? "")).toMatchObject({
			projectName: "Runtime migration",
			tags: ["frontend"],
			teamMembers: [{ name: "Grace", role: "qa" }],
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
