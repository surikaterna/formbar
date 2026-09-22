// @vitest-environment jsdom
import type { ValidationIssue } from "@formbar/core";
import type { FormDefinition } from "@formbar/declarative";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { binding, literal, mountForm } from "./renderer-test-utils.js";

const a11yDefinition: FormDefinition = {
	version: 1,
	id: "a11y",
	root: {
		type: "group",
		id: "root",
		children: [
			{
				type: "field",
				id: "name-field",
				binding: binding("name"),
				widget: "text",
				label: "Name",
				props: { description: literal("Your public name") },
			},
			{
				type: "field",
				id: "choice-field",
				binding: binding("choice"),
				widget: "radio",
				label: "Choice",
				props: { options: literal([1, 2]) },
			},
			{ type: "validation", id: "name-validation", binding: binding("name"), messages: ["Correct the name"] },
		],
	},
};

const idDefinition: FormDefinition = {
	version: 1,
	id: "id-collisions",
	root: {
		type: "group",
		id: "root",
		children: [
			{ type: "field", id: "a.b", binding: binding("dot"), widget: "text", label: "Dot" },
			{ type: "field", id: "a/b", binding: binding("slash"), widget: "text", label: "Slash" },
			{ type: "field", id: "雪✨[]?", binding: binding("unicode"), widget: "text", label: "Unicode" },
		],
	},
};

const mounted: Array<{ unmount(): void }> = [];
afterEach(() => {
	for (const item of mounted.splice(0)) item.unmount();
});

describe("renderer accessibility", () => {
	it("links labels, descriptions, errors, radio groups, summary, and first-error focus", async () => {
		const submit = vi.fn().mockResolvedValue({ ok: true });
		let submitCalls = 0;
		const issue = validationIssue("name", "Name is required");
		const view = mountForm({
			schema: {
				type: "object",
				required: ["name"],
				properties: { name: { type: "string" }, choice: { enum: [1, 2] } },
			},
			definition: a11yDefinition,
			data: { name: "", choice: 1 },
			formOptions: { validators: [() => [issue]], onSubmit: submit },
			prepareForm(form) {
				const original = form.submit;
				form.submit = (...args) => {
					submitCalls += 1;
					return original(...args);
				};
			},
		});
		mounted.push(view);
		const name = view.container.querySelector('[data-formbar-node="name-field"] input') as HTMLInputElement;
		const label = view.container.querySelector("label[for]") as HTMLLabelElement;
		expect(label.htmlFor).toBe(name.id);
		expect(document.getElementById(name.getAttribute("aria-describedby") as string)?.textContent).toBe(
			"Your public name",
		);
		const radios = [...view.container.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
		expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
		expect(radios.every((radio) => Boolean(document.querySelector(`label[for="${radio.id}"]`)))).toBe(true);
		await act(async () => {
			view.container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
			await Promise.resolve();
		});
		expect(submit).not.toHaveBeenCalled();
		expect(submitCalls).toBe(1);
		expect(name.getAttribute("aria-invalid")).toBe("true");
		const errorId = name.getAttribute("aria-errormessage") as string;
		expect(document.getElementById(errorId)?.textContent).toContain("Name is required");
		expect(view.container.querySelector('[data-formbar-node="name-validation"]')?.textContent).toBe("Correct the name");
		const link = view.container.querySelector("[data-formbar-error-summary] a") as HTMLAnchorElement;
		expect(link.hash).toBe(`#${name.id}`);
		expect(document.activeElement).toBe(name);
		expect(view.container.querySelectorAll('[role="alert"]')).toHaveLength(1);
		expect(view.container.querySelector("[data-formbar-status]")?.textContent).toBe("");
	});
});

describe("renderer accessibility state and IDs", () => {
	it("does not mark warning-only fields invalid", async () => {
		const definition: FormDefinition = {
			version: 1,
			id: "warning",
			root: { type: "field", id: "name", binding: binding("name"), widget: "text" },
		};
		const warning = { ...validationIssue("name", "Check the name"), severity: "warning" as const };
		const view = mountForm({
			schema: { type: "object", properties: { name: { type: "string" } } },
			definition,
			data: { name: "Ada", choice: 1 },
			formOptions: { validators: [() => [warning]] },
		});
		mounted.push(view);
		await act(async () => {
			view.form.field("name").markTouched();
			await view.form.submit();
		});
		const input = view.container.querySelector("input") as HTMLInputElement;
		expect(input.getAttribute("aria-invalid")).toBeNull();
		expect(input.getAttribute("aria-describedby")).toContain("error");
	});

	it("creates collision-proof IDs for punctuation and Unicode across duplicate forms", () => {
		const options = {
			schema: {
				type: "object",
				properties: { dot: { type: "string" }, slash: { type: "string" }, unicode: { type: "string" } },
			},
			definition: idDefinition,
			data: { dot: "d", slash: "s", unicode: "u" },
		};
		const first = mountForm(options);
		const second = mountForm(options);
		mounted.push(first, second);
		const controls = [...first.container.querySelectorAll("input"), ...second.container.querySelectorAll("input")];
		const ids = controls.map((control) => control.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids.every((id) => /^[A-Za-z0-9_-]+$/.test(id))).toBe(true);
		for (const control of controls) expect(document.querySelector(`label[for="${control.id}"]`)).not.toBeNull();
	});
});

describe("renderer error-summary focus", () => {
	it("links and focuses only rendered supported focusable error controls", async () => {
		const view = mountSummaryForm(false);
		await submitNative(view.container);
		const real = view.container.querySelector('[data-formbar-node="real"] input') as HTMLInputElement;
		const links = [...view.container.querySelectorAll("[data-formbar-error-summary] a")];
		expect(links.map((link) => link.getAttribute("href"))).toEqual([`#${real.id}`]);
		expect(document.activeElement).toBe(real);
	});

	it("focuses the summary when all errored fields are hidden, disabled, or fallbacks", async () => {
		const view = mountSummaryForm(true);
		await submitNative(view.container);
		const summary = view.container.querySelector("[data-formbar-error-summary]");
		expect(summary?.querySelector("a")).toBeNull();
		expect(document.activeElement).toBe(summary);
	});
});

function validationIssue(path: string, message: string): ValidationIssue {
	return {
		code: "required",
		message,
		severity: "error",
		path: { namespace: "data", segments: [path] },
		source: { origin: "function-validator", validatorId: "renderer-test" },
	};
}

function summaryDefinition(disableReal: boolean): FormDefinition {
	return {
		version: 1,
		id: `summary-${disableReal}`,
		root: {
			type: "group",
			id: "root",
			children: [
				{ type: "field", id: "bad-widget", binding: binding("badWidget"), widget: "slider" },
				{ type: "field", id: "bad-binding", binding: binding(), widget: "text" },
				{
					type: "field",
					id: "bad-options",
					binding: binding("badOptions"),
					widget: "select",
					props: { options: { mode: "literal", value: { bad: true } } },
				},
				{ type: "field", id: "hidden", binding: binding("hidden"), widget: "text", visible: expression(false) },
				{ type: "field", id: "disabled", binding: binding("disabled"), widget: "text", disabled: expression(true) },
				{ type: "field", id: "real", binding: binding("real"), widget: "text", disabled: expression(disableReal) },
			],
		},
	};
}

function mountSummaryForm(disableReal: boolean) {
	const issues = [
		validationIssue("badWidget", "Bad widget"),
		{ ...validationIssue("root", "Bad binding"), path: { namespace: "data" as const, segments: [] } },
		validationIssue("badOptions", "Bad options"),
		validationIssue("hidden", "Hidden"),
		validationIssue("disabled", "Disabled"),
		validationIssue("real", "Real"),
	];
	const view = mountForm({
		schema: {
			type: "object",
			properties: Object.fromEntries(
				["badWidget", "badOptions", "hidden", "disabled", "real"].map((key) => [key, { type: "string" }]),
			),
		},
		definition: summaryDefinition(disableReal),
		data: { badWidget: "x", badOptions: "x", hidden: "x", disabled: "x", real: "x" },
		formOptions: { validators: [() => issues] },
	});
	mounted.push(view);
	return view;
}

async function submitNative(container: HTMLElement): Promise<void> {
	await act(async () => {
		container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
		await Promise.resolve();
	});
}

function expression(value: boolean) {
	return { kind: "literal", value } as const;
}
