// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { change, mountForm } from "./renderer-test-utils.js";

const mounted: Array<ReturnType<typeof mountForm<Record<string, unknown>>>> = [];
afterEach(() => {
	for (const view of mounted.splice(0)) view.unmount();
});

describe("generated typed enum native renderer interop", () => {
	it.each([
		["string", ["", "CA", "US"], "US"],
		["integer", [0, -2, 3], -2],
		["number", [1.5, 0, -2.25], -2.25],
		["boolean", [false, true], true],
	] as const)("renders ordered %s choices and stores the exact primitive", (type, values, selected) => {
		const view = mountForm({ schema: { type: "object", properties: { choice: { type, enum: values } } }, data: {} });
		mounted.push(view);
		const select = view.container.querySelector("select") as HTMLSelectElement;
		expect(select).not.toBeNull();
		expect(Array.from(select.options).map((option) => option.textContent)).toEqual(["", ...values.map(String)]);
		change(select, `option-${values.indexOf(selected)}`);
		expect(view.form.getState().data.choice).toBe(selected);
	});

	it("honors a schema radio widget without coercing boolean values", () => {
		const view = mountForm({
			schema: {
				type: "object",
				properties: {
					enabled: {
						type: "boolean",
						enum: [false, true],
						"x-formbar": { widget: "radio" },
					},
				},
			},
			data: {},
		});
		mounted.push(view);
		const radios = view.container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
		expect(radios).toHaveLength(2);
		act(() => radios[0].click());
		expect(view.form.getState().data.enabled).toBe(false);
	});

	it("renders existing direct primitive array items with typed choice updates", () => {
		const view = mountForm({
			schema: {
				type: "object",
				properties: {
					choices: {
						type: "array",
						items: { type: "integer", enum: [1, 2] },
					},
				},
			},
			data: { choices: [1] },
		});
		mounted.push(view);
		const select = view.container.querySelector("select") as HTMLSelectElement;
		expect(select).not.toBeNull();
		change(select, "option-1");
		expect(view.form.getState().data.choices).toEqual([2]);
	});
});
