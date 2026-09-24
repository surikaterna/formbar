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
		["string", ["allowed"], ["forbidden"], "allowed"],
		["integer", [1], ["1", 2], 1],
		["string", ["allowed"], [{ value: "forbidden", title: "Forbidden", disabled: true }], "allowed"],
	] as const)(
		"does not render or store conflicting %s extension choices %#",
		async (type, values, options, selected) => {
			const view = mountForm({
				schema: {
					type: "object",
					properties: {
						choice: {
							type,
							enum: values,
							"x-formbar": { props: { options } },
						},
					},
				},
				data: {},
			});
			mounted.push(view);
			const select = view.container.querySelector("select") as HTMLSelectElement;
			expect(Array.from(select.options).map((option) => option.textContent)).toEqual(["", ...values.map(String)]);
			expect(view.prepared.diagnostics.compilation).toContainEqual(
				expect.objectContaining({
					code: "unsupported-schema",
					message: expect.stringContaining("schema enum choices are authoritative"),
				}),
			);
			expect(view.prepared.sourceValidator).toBeUndefined();
			change(select, "option-0");
			expect(view.form.getState().data.choice).toBe(selected);
			// JSON Schema provider exposes no validator here; UI containment, not validation, enforces the choices.
			expect(await view.form.validate()).toEqual([]);
			act(() => view.form.reset());
			expect(view.form.getState().data).toEqual({});
		},
	);

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

	it("retains explicit authored options and non-enum options-only selection", () => {
		const schema = { type: "object", properties: { choice: { type: "string", enum: ["allowed"] } } };
		const authored = mountForm({
			schema,
			definition: {
				version: 1,
				id: "authored",
				root: {
					id: "authored-choice",
					type: "field",
					widget: "select",
					binding: { namespace: "data", segments: ["choice"] },
					props: { options: { mode: "literal", value: ["authored"] } },
				},
			},
			data: {},
		});
		mounted.push(authored);
		const authoredSelect = authored.container.querySelector("select") as HTMLSelectElement;
		expect(Array.from(authoredSelect.options).map((option) => option.textContent)).toEqual(["", "authored"]);
		change(authoredSelect, "option-0");
		expect(authored.form.getState().data.choice).toBe("authored");
		const optionsOnly = mountForm({
			schema: {
				type: "object",
				properties: {
					choice: {
						type: "string",
						"x-formbar": { widget: "select", props: { options: ["free"] } },
					},
				},
			},
			data: {},
		});
		mounted.push(optionsOnly);
		const select = optionsOnly.container.querySelector("select") as HTMLSelectElement;
		expect(Array.from(select.options).map((option) => option.textContent)).toEqual(["", "free"]);
		change(select, "option-0");
		expect(optionsOnly.form.getState().data.choice).toBe("free");
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
