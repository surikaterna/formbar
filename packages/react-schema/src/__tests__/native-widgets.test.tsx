// @vitest-environment jsdom
import type { FieldNode, FormDefinition } from "@formbar/declarative";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { binding, change, input, literal, mountForm } from "./renderer-test-utils.js";

const widgets = [
	["text", "text"],
	["textarea", "textarea"],
	["number", "number"],
	["select", "select"],
	["checkbox", "checkbox"],
	["radio", "radio"],
	["date", "date"],
	["time", "time"],
	["email", "email"],
	["url", "url"],
	["tel", "tel"],
	["password", "password"],
	["search", "search"],
] as const;

const fields: FieldNode[] = widgets.map(([name, widget]) => ({
	type: "field",
	id: name,
	binding: binding(name),
	widget,
	props:
		widget === "select" || widget === "radio"
			? { options: literal(["", 2, true, null]) }
			: { placeholder: literal(`Enter ${name}`), description: literal(`${name} help`) },
}));
fields.push({ type: "field", id: "formatted", binding: binding("formatted"), widget: "text" });
fields.push({ type: "field", id: "integer", binding: binding("integer"), widget: "number" });

const definition: FormDefinition = {
	version: 1,
	id: "widgets",
	root: { type: "group", id: "root", children: fields },
};

const schema = {
	type: "object",
	properties: {
		text: { type: "string", minLength: 2, maxLength: 8, pattern: "^[a-z]*$" },
		textarea: { type: "string" },
		number: { type: "number", minimum: 1, maximum: 9 },
		select: { enum: ["", 2, true, null] },
		checkbox: { type: "boolean" },
		radio: { enum: ["", 2, true, null] },
		date: { type: "string", format: "date" },
		time: { type: "string", format: "time" },
		email: { type: "string", format: "email" },
		url: { type: "string", format: "uri" },
		tel: { type: "string" },
		password: { type: "string" },
		search: { type: "string" },
		formatted: { type: "string", format: "email" },
		integer: { type: "integer" },
	},
};

const mounted: Array<ReturnType<typeof mountForm<Record<string, unknown>>>> = [];
afterEach(() => {
	for (const item of mounted.splice(0)) item.unmount();
});

describe("native widgets", () => {
	it("renders the complete widget matrix and descriptor constraints", () => {
		const view = mount();
		for (const [id, widget] of widgets) {
			const node = view.container.querySelector(`[data-formbar-node="${id}"]`);
			expect(node).not.toBeNull();
			if (widget === "textarea") expect(node?.querySelector("textarea")).not.toBeNull();
			else if (widget === "select") expect(node?.querySelector("select")).not.toBeNull();
			else expect(node?.querySelector(`input[type="${widget}"]`)).not.toBeNull();
		}
		const text = view.container.querySelector('[data-formbar-node="text"] input') as HTMLInputElement;
		expect([text.minLength, text.maxLength, text.pattern, text.placeholder]).toEqual([2, 8, "^[a-z]*$", "Enter text"]);
		const number = view.container.querySelector('[data-formbar-node="number"] input') as HTMLInputElement;
		expect([number.min, number.max, number.step]).toEqual(["1", "9", "any"]);
		expect((view.container.querySelector('[data-formbar-node="integer"] input') as HTMLInputElement).step).toBe("1");
		expect((view.container.querySelector('[data-formbar-node="formatted"] input') as HTMLInputElement).type).toBe(
			"email",
		);
	});
});

describe("native scalar edits", () => {
	it("preserves scalar and explicit empty conversion semantics", () => {
		const view = mount();
		const text = view.container.querySelector('[data-formbar-node="text"] input') as HTMLInputElement;
		input(text, "");
		expect(view.form.getState().data.text).toBe("");
		const number = view.container.querySelector('[data-formbar-node="number"] input') as HTMLInputElement;
		input(number, "1.5");
		expect(view.form.getState().data.number).toBe(1.5);
		expect(number.validity.stepMismatch).toBe(false);
		expect(number.checkValidity()).toBe(true);
		input(number, "not-a-number");
		expect(view.form.getState().data.number).toBeUndefined();
		input(number, "");
		expect(view.form.getState().data.number).toBeUndefined();
		const select = view.container.querySelector("select") as HTMLSelectElement;
		change(select, "option-1");
		expect(view.form.getState().data.select).toBe(2);
		change(select, "");
		expect(view.form.getState().data.select).toBeUndefined();
		const checkbox = view.container.querySelector('input[type="checkbox"]') as HTMLInputElement;
		act(() => checkbox.click());
		expect(view.form.getState().data.checkbox).toBe(true);
		const radio = view.container.querySelectorAll('input[type="radio"]')[2] as HTMLInputElement;
		act(() => radio.click());
		expect(view.form.getState().data.radio).toBe(true);
	});
});

describe("native string values", () => {
	it("writes native string, date, and time values without conversion", () => {
		const view = mount();
		const stringValues = {
			textarea: "updated textarea",
			email: "next@example.com",
			url: "https://formbar.dev",
			tel: "+1234",
			password: "updated password",
			search: "updated search",
			formatted: "format@example.com",
		};
		for (const [id, value] of Object.entries(stringValues)) {
			const control = view.container.querySelector(
				`[data-formbar-node="${id}"] ${id === "textarea" ? "textarea" : "input"}`,
			) as HTMLInputElement;
			input(control, value);
			expect(view.form.getState().data[id]).toBe(value);
		}
		for (const [id, value] of [
			["date", "2027-01-02"],
			["time", "13:45"],
		] as const) {
			const control = view.container.querySelector(`[data-formbar-node="${id}"] input`) as HTMLInputElement;
			input(control, value);
			expect(view.form.getState().data[id]).toBe(value);
			input(control, "");
			expect(view.form.getState().data[id]).toBeUndefined();
		}
	});
});

describe("native temporal values", () => {
	it("renders only date and time values that native controls preserve", () => {
		const view = mount();
		expectAcceptedTemporal(view, "date", ["0001-01-01", "2000-02-29", "9999-12-31", "10000-01-01"]);
		expectRejectedTemporal(view, "date", ["0000-01-01", "1900-02-29", "2024-04-31"]);
		expectAcceptedTemporal(view, "time", [
			"00:00",
			"23:59",
			"00:00:00",
			"23:59:59",
			"12:30:00.1",
			"12:30:00.12",
			"12:30:00.123",
		]);
		expectRejectedTemporal(view, "time", ["12:30:00.1234", "24:00", "23:60", "23:59:60"]);
	});
});

describe("unsupported native values", () => {
	it("rejects non-finite current number values visibly", () => {
		const view = mount();
		act(() => view.form.fieldDynamic("/number").handleChange(Number.POSITIVE_INFINITY as never));
		expect(view.container.querySelector('[data-formbar-node="number"]')?.getAttribute("data-formbar-diagnostic")).toBe(
			"unsupported-widget",
		);
	});
});

type MountedWidgets = ReturnType<typeof mount>;

function expectAcceptedTemporal(view: MountedWidgets, type: "date" | "time", values: readonly string[]): void {
	for (const value of values) {
		act(() => view.form.setValue(type, value));
		const node = view.container.querySelector(`[data-formbar-node="${type}"]`);
		expect(node?.getAttribute("data-formbar-diagnostic")).toBeNull();
		expect((node?.querySelector("input") as HTMLInputElement).value).toBe(value);
	}
}

function expectRejectedTemporal(view: MountedWidgets, type: "date" | "time", values: readonly string[]): void {
	for (const value of values) {
		const browserControl = document.createElement("input");
		browserControl.type = type;
		browserControl.value = value;
		expect(browserControl.value).toBe("");
		act(() => view.form.setValue(type, value));
		const node = view.container.querySelector(`[data-formbar-node="${type}"]`);
		expect(node?.getAttribute("data-formbar-diagnostic")).toBe("unsupported-widget");
		expect(node?.querySelector("input")).toBeNull();
		expect(node?.textContent).toBe("This form item cannot be rendered.");
	}
}

function mount() {
	const view = mountForm({
		schema,
		definition,
		data: {
			text: "abc",
			textarea: "long",
			number: 3,
			select: "",
			checkbox: false,
			radio: 2,
			date: "2026-09-22",
			time: "12:30",
			email: "a@example.com",
			url: "https://example.com",
			tel: "123",
			password: "secret",
			search: "query",
			formatted: "formatted@example.com",
			integer: 2,
		},
	});
	mounted.push(view);
	return view;
}
