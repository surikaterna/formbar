// @vitest-environment jsdom
import type { FormDefinition, OutputFormat } from "@formbar/declarative";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { binding, mountForm } from "./renderer-test-utils.js";

const schema = {
	type: "object",
	properties: {
		amount: { type: "number" },
		count: { type: "number" },
		other: { type: "number" },
		object: { type: "object" },
	},
};
const mounted: Array<ReturnType<typeof mountForm<Record<string, unknown>>>> = [];

afterEach(() => {
	for (const item of mounted.splice(0)) item.unmount();
});

describe("output rendering", () => {
	it.each([
		["plain", 12.345, "12.345"],
		["number", 1234.567, "1,234.57"],
		["currency-usd", 1234.5, "$1,234.50"],
		["percent", 0.1, "10%"],
	] as const)("renders the %s formatter in a semantic labeled output", (format, amount, text) => {
		const view = mount(outputDefinition(format, "Total"), { amount, count: 1, other: 0, object: {} });
		const wrapper = view.container.querySelector('[data-formbar-node="result"]');
		const output = wrapper?.querySelector("output");
		const label = output ? document.getElementById(output.getAttribute("aria-labelledby") ?? "") : null;
		expect(output?.textContent).toBe(text);
		expect(label?.textContent).toBe("Total");
		expect(wrapper?.getAttribute("data-formbar-span-base")).toBe("6");
		expect(wrapper?.getAttribute("style")).toContain("--formbar-span-base: 6");
	});

	it("uses the accessible fallback label and renders null without diagnostics", () => {
		const view = mount(outputDefinition("plain"), { amount: null, count: 1, other: 0, object: {} });
		const output = view.container.querySelector("output");
		const labelId = output?.getAttribute("aria-labelledby") ?? "";
		expect(document.getElementById(labelId)?.textContent).toBe("Calculated value");
		expect(output?.textContent).toBe("Not available");
		expect(view.container.querySelector('[role="status"]')).toBeNull();
	});

	it("reacts to edits, reset, and replacement directly from core snapshots", () => {
		const view = mount(calculationDefinition(), { amount: 10, count: 2, other: 0, object: {} });
		const text = () => view.container.querySelector("output")?.textContent;
		expect(text()).toBe("$5.00");
		act(() => view.form.setValue("amount", 12));
		expect(text()).toBe("$6.00");
		act(() => view.form.reset());
		expect(text()).toBe("$5.00");
		act(() => view.form.reset({ data: { amount: 21, count: 3, other: 0, object: {} } }));
		expect(text()).toBe("$7.00");
	});

	it("does not surface hidden outputs or evaluate their missing value", () => {
		const definition: FormDefinition = {
			version: 1,
			id: "hidden-output",
			root: {
				type: "output",
				id: "result",
				visible: { kind: "literal", value: false },
				value: { kind: "ref", ref: binding("missing") },
			},
		};
		const view = mount(definition, { amount: 1, count: 1, other: 0, object: {} });
		expect(view.container.querySelector('[data-formbar-node="result"]')).toBeNull();
		expect(view.container.querySelector('[data-formbar-diagnostic="output-unresolved"]')).toBeNull();
	});

	it("renders deterministic accessible diagnostics without leaking failures or stale values", () => {
		const view = mount(calculationDefinition(), { amount: 10, count: 2, other: 0, object: {} });
		expect(view.container.querySelector("output")?.textContent).toBe("$5.00");
		act(() => view.form.setValue("count", 0));
		const fallback = view.container.querySelector('[data-formbar-diagnostic="output-unresolved"]');
		expect(fallback?.getAttribute("role")).toBe("status");
		expect(fallback?.textContent).toBe("Calculated value is unavailable.");
		expect(fallback?.textContent).not.toContain("division");
		expect(view.container.querySelector("output")).toBeNull();
	});

	it("fails closed for object and numeric-format type mismatches", () => {
		const objectView = mount(referenceDefinition("object", "plain"), {
			amount: 1,
			count: 1,
			other: 0,
			object: { private: "not rendered" },
		});
		expect(
			objectView.container.querySelector('[data-formbar-diagnostic="unsupported-output-value"]')?.textContent,
		).toBe("Calculated value is unavailable.");
		expect(objectView.container.textContent).not.toContain("private");

		const stringView = mount(referenceDefinition("object", "number"), {
			amount: 1,
			count: 1,
			other: 0,
			object: "12",
		});
		expect(stringView.container.querySelector('[data-formbar-diagnostic="unsupported-output-value"]')).not.toBeNull();
	});

	it("releases the single runtime subscription after StrictMode cleanup", async () => {
		let subscriptions = 0;
		const view = mountForm({
			schema,
			definition: outputDefinition("plain"),
			data: { amount: 1, count: 1, other: 0, object: {} },
			strict: true,
			prepareForm(form) {
				trackSubscriptions(form, (count) => {
					subscriptions = count;
				});
			},
		});
		expect(subscriptions).toBe(2);
		act(() => view.root.unmount());
		view.container.remove();
		await Promise.resolve();
		expect(subscriptions).toBe(0);
		expect(view.form.isDisposed()).toBe(false);
		view.form.dispose();
	});
});

function mount(definition: FormDefinition, data: Record<string, unknown>) {
	const view = mountForm({ schema, definition, data, strict: true });
	mounted.push(view);
	return view;
}

function outputDefinition(format: OutputFormat, label?: string): FormDefinition {
	return {
		version: 1,
		id: "formatted-output",
		root: {
			type: "output",
			id: "result",
			value: { kind: "ref", ref: binding("amount") },
			format,
			...(label ? { label } : {}),
			presentation: { span: 6 },
		},
	};
}

function calculationDefinition(): FormDefinition {
	return {
		version: 1,
		id: "calculation-output",
		root: {
			type: "output",
			id: "result",
			label: "Per item",
			format: "currency-usd",
			value: {
				kind: "op",
				op: "div",
				args: [
					{ kind: "ref", ref: binding("amount") },
					{ kind: "ref", ref: binding("count") },
				],
			},
		},
	};
}

function referenceDefinition(segment: string, format: OutputFormat): FormDefinition {
	return {
		version: 1,
		id: "reference-output",
		root: { type: "output", id: "result", value: { kind: "ref", ref: binding(segment) }, format },
	};
}

function trackSubscriptions(
	form: ReturnType<typeof mountForm<Record<string, unknown>>>["form"],
	report: (count: number) => void,
): void {
	const subscribe = form.subscribe;
	let count = 0;
	form.subscribe = (listener) => {
		const stop = subscribe(listener);
		count += 1;
		report(count);
		return () => {
			count -= 1;
			report(count);
			stop();
		};
	};
}
