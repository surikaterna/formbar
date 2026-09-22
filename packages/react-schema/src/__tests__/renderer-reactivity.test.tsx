// @vitest-environment jsdom
import { createForm } from "@formbar/core";
import type { FormApi, FormPlugin, ValidationIssue } from "@formbar/core";
import type { FormDefinition } from "@formbar/declarative";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FormRenderer } from "../index.js";
import { binding, input, mountForm } from "./renderer-test-utils.js";

const definition: FormDefinition = {
	version: 1,
	id: "reactive",
	root: {
		type: "group",
		id: "root",
		children: [
			{ type: "field", id: "name", binding: binding("name"), widget: "text" },
			{ type: "field", id: "other", binding: binding("other"), widget: "text" },
		],
	},
};

const schema = {
	type: "object",
	properties: { name: { type: "string" }, other: { type: "string" }, tick: { type: "number" } },
};
const mounted: Array<ReturnType<typeof mountForm<Record<string, unknown>>>> = [];
afterEach(() => {
	for (const item of mounted.splice(0)) item.unmount();
});

describe("renderer reactivity", () => {
	it("reflects core value, blur lifecycle, and resolved policy without mirrors", () => {
		let restricted = false;
		const plugin: FormPlugin = {
			id: "policy",
			evaluate: () => ({
				fieldPolicy: restricted ? [{ path: "name", disabled: true, readOnly: true, required: true }] : [],
			}),
		};
		const view = mount({
			data: { name: "Ada", other: "stable", tick: 0 },
			formOptions: { plugins: [plugin] },
		});
		const control = view.container.querySelector('[data-formbar-node="name"] input') as HTMLInputElement;
		input(control, "Grace");
		expect(view.form.getState().data.name).toBe("Grace");
		expect(view.container.querySelector('[data-formbar-node="name"]')?.getAttribute("data-formbar-dirty")).toBe("true");
		act(() => control.dispatchEvent(new FocusEvent("blur", { bubbles: true })));
		expect(view.form.field("name").isTouched()).toBe(true);
		act(() => {
			restricted = true;
			view.form.setValue("tick", 1);
		});
		expect(control.disabled).toBe(true);
		expect(control.required).toBe(true);
	});
});

describe("renderer subscription lifecycle", () => {
	it("suppresses unrelated node replacement and releases StrictMode subscriptions", async () => {
		let subscriptions = 0;
		const view = mount({
			data: { name: "Ada", other: "stable", tick: 0 },
			strict: true,
			prepareForm(form) {
				trackSubscriptions(form, (count) => {
					subscriptions = count;
				});
			},
		});
		const before = view.container.querySelector('[data-formbar-node="name"] input');
		expect(subscriptions).toBe(2);
		act(() => view.form.setValue("other", "changed"));
		expect(view.container.querySelector('[data-formbar-node="name"] input')).toBe(before);
		act(() => view.root.unmount());
		view.container.remove();
		mounted.splice(mounted.indexOf(view), 1);
		await Promise.resolve();
		expect(subscriptions).toBe(0);
		expect(view.form.isDisposed()).toBe(false);
		view.form.dispose();
	});

	it("replaces and disposes private runtime subscriptions without disposing either caller form", async () => {
		let firstSubscriptions = 0;
		const view = mount({
			data: { name: "first", other: "stable", tick: 0 },
			prepareForm(form) {
				trackSubscriptions(form, (count) => {
					firstSubscriptions = count;
				});
			},
		});
		const second = createForm({ initialData: { name: "second", other: "stable", tick: 0 }, initialUiState: {} });
		act(() => view.root.render(<FormRenderer {...view.prepared} form={second} />));
		await Promise.resolve();
		expect(firstSubscriptions).toBe(0);
		expect(view.form.isDisposed()).toBe(false);
		expect(second.isDisposed()).toBe(false);
		view.unmount();
		mounted.splice(mounted.indexOf(view), 1);
		second.dispose();
	});
});

describe("renderer selected updates", () => {
	it("keeps untouched handlers stable for unrelated issues, policy, and values", async () => {
		let issueMessage = "first global issue";
		let restrictOther = false;
		const plugin: FormPlugin = {
			id: "other-policy",
			evaluate: () => ({ fieldPolicy: restrictOther ? [{ path: "other", disabled: true }] : [] }),
		};
		const view = mount({
			data: { name: "Ada", other: "stable", tick: 0 },
			formOptions: { plugins: [plugin], validators: [() => [globalIssue(issueMessage)]] },
		});
		await act(async () => void (await view.form.submit()));
		const control = view.container.querySelector('[data-formbar-node="name"] input') as HTMLInputElement;
		const initial = reactChangeHandler(control);
		issueMessage = "second global issue";
		await act(async () => void (await view.form.submit()));
		expect(reactChangeHandler(control)).toBe(initial);
		act(() => view.form.setValue("other", "changed"));
		expect(reactChangeHandler(control)).toBe(initial);
		act(() => {
			restrictOther = true;
			view.form.setValue("tick", 1);
		});
		expect(reactChangeHandler(control)).toBe(initial);
		act(() => view.form.setValue("name", "Grace"));
		expect(reactChangeHandler(control)).not.toBe(initial);
	});
});

function mount(options: Omit<Parameters<typeof mountForm<Record<string, unknown>>>[0], "schema" | "definition">) {
	const view = mountForm({ schema, definition, ...options });
	mounted.push(view);
	return view;
}

function trackSubscriptions(
	form: FormApi<Record<string, unknown>, Record<string, never>>,
	report: (count: number) => void,
) {
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

function globalIssue(message: string): ValidationIssue {
	return {
		code: "global",
		message,
		severity: "error",
		path: { namespace: "data", segments: ["global"] },
		source: { origin: "function-validator", validatorId: "reactivity" },
	};
}

function reactChangeHandler(element: HTMLInputElement): unknown {
	const key = Object.keys(element).find((item) => item.startsWith("__reactProps$"));
	if (!key) throw new Error("React props were not attached to the control");
	const props = (element as unknown as Record<string, { readonly onChange?: unknown }>)[key];
	return props?.onChange;
}
