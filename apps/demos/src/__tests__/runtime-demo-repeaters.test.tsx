// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { arrayItemsDemo, arrayItemsSchema } from "../demos/08-array-items";
import { orderEntryDemo } from "../demos/14-order-entry";
import type { SchemaDemoFixture } from "../demos/baseline-contracts";
import { createJsonSchemaValidator } from "../validation/json-schema-validator";
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
		const tagControls = [...view.container.querySelectorAll('[data-formbar-node="f-tag"] [data-widget]')];
		expect(tagControls).toHaveLength(2);
		const tags = selects(view, "Tag");
		for (const select of tags) {
			expect([...select.options].map((option) => option.textContent)).toEqual(["(empty tag)", "frontend", "Back end"]);
			expect(select.options[2].disabled).toBe(true);
			expect(select.selectedOptions[0].value).toBe("option-0");
			expect(select.getAttribute("aria-labelledby")).toBeTruthy();
		}
		expect(document.activeElement).toBe(tags[1]);
		expect(button(view, "Add Tags").disabled).toBe(true);
		setSelect(tags[0], "option-1");
		setSelect(tags[1], "option-1");
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
		for (const role of selects(view, "Role")) {
			expect(role.options[0].value).toBe("");
			expect([...role.options].map((option) => option.textContent)).toEqual([
				"",
				"Team lead",
				"Developer",
				"Designer",
				"Quality assurance",
			]);
		}
		setSelect(selects(view, "Role")[0], "option-1");
		setSelect(selects(view, "Role")[1], "option-3");
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
		const successful = resultJson(view);
		await click(button(view, "Reset"));
		expect((labelled(view, "Project Name") as HTMLInputElement).value).toBe("");
		expect(view.container.querySelectorAll('[data-formbar-node="f-tag"]')).toHaveLength(0);
		expect(inputs(view, "Name")).toHaveLength(0);
		expect(resultJson(view)).toBe(successful);
	});

	it("submits the schema-valid empty tag seed and restores the empty array on reset", async () => {
		const submitted = vi.fn();
		const view = await mountDemo(arrayItemsDemo, submitted);
		setInput(labelled(view, "Project Name") as HTMLInputElement, "Seed project");
		await click(button(view, "Add Tags"));
		expect(selects(view, "Tag")[0].value).toBe("option-0");
		await click(button(view, "Submit"));
		expect(submitted).toHaveBeenCalledWith(expect.objectContaining({ projectName: "Seed project", tags: [""] }));
		const successful = resultJson(view);
		await click(button(view, "Reset"));
		expect(view.container.querySelectorAll('[data-formbar-node="f-tag"]')).toHaveLength(0);
		expect(resultJson(view)).toBe(successful);
	});

	it("returns from frontend to the sole labeled empty-string tag choice without changing its schema type", async () => {
		const submitted = vi.fn();
		const view = await mountDemo(arrayItemsDemo, submitted);
		setInput(labelled(view, "Project Name") as HTMLInputElement, "Blank tag");
		await click(button(view, "Add Tags"));
		const tag = selects(view, "Tag")[0];
		setSelect(tag, "option-1");
		expect(selects(view, "Tag")[0].value).toBe("option-1");
		await act(async () => {
			await Promise.resolve();
		});
		setSelect(selects(view, "Tag")[0], "option-0");
		expect([...selects(view, "Tag")[0].options].map((option) => option.textContent)).toEqual([
			"(empty tag)",
			"frontend",
			"Back end",
		]);
		await click(button(view, "Submit"));
		expect(submitted).toHaveBeenCalledWith(expect.objectContaining({ tags: [""] }));
		expect(view.container.querySelector("[data-formbar-error-summary]")).toBeNull();
		await click(button(view, "Reset"));
		expect(selects(view, "Tag")).toHaveLength(0);
		await click(button(view, "Add Tags"));
		expect(selects(view, "Tag")[0].value).toBe("option-0");
	});

	it("preserves an unlisted schema-valid tag without silently replacing it with a presented option", async () => {
		const fixture: SchemaDemoFixture = {
			...arrayItemsDemo,
			sources: [
				{
					...arrayItemsDemo.sources[0],
					initialData: { ...arrayItemsDemo.sources[0].initialData, tags: ["outside-ui-domain"] },
				},
			],
		};
		const submitted = vi.fn();
		const view = await mountDemo(fixture, submitted);
		const tag = selects(view, "Tag")[0];
		expect(tag.selectedOptions[0].textContent).toBe("outside-ui-domain");
		setInput(labelled(view, "Project Name") as HTMLInputElement, "Outside UI");
		await click(button(view, "Submit"));
		expect(submitted).toHaveBeenCalledWith(expect.objectContaining({ tags: ["outside-ui-domain"] }));
		expect(tag.selectedOptions[0].textContent).toBe("outside-ui-domain");
	});

	it("keeps empty and non-presented tag strings schema-valid while enforcing array constraints", () => {
		const validate = createJsonSchemaValidator(arrayItemsSchema);
		expect(validate({ data: { projectName: "Project", tags: [""] }, uiState: {} })).toEqual([]);
		expect(validate({ data: { projectName: "Project", tags: ["outside-ui-domain"] }, uiState: {} })).toEqual([]);
		expect(validate({ data: { projectName: "Project", tags: ["frontend", "frontend"] }, uiState: {} })).toMatchObject([
			{ code: "json-schema.uniqueItems", path: { segments: ["tags"] } },
		]);
		expect(
			validate({ data: { projectName: "Project", tags: ["", "frontend", "backend"] }, uiState: {} }),
		).toMatchObject([{ code: "json-schema.maxItems", path: { segments: ["tags"] } }]);
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
