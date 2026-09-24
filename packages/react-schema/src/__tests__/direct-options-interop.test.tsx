import type { FormPlugin } from "@formbar/core";
// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { change, mountForm } from "./renderer-test-utils.js";

const mounted: Array<ReturnType<typeof mountForm<Record<string, unknown>>>> = [];
afterEach(() => {
	for (const view of mounted.splice(0)) view.unmount();
});

describe("schema-only native option presentation", () => {
	it.each([
		{
			schema: {
				enum: ["lead", "qa"],
				"x-formbar": { props: { options: ["rogue"] }, options: [{ value: "lead", title: "Team lead" }] },
			},
			widget: "select",
			labels: ["Team lead", "qa"],
			selected: "qa",
		},
		{
			schema: {
				type: "string",
				enum: ["a", "b"],
				"x-formbar": { widget: "radio", props: { options: ["rogue"] }, options: [{ value: "b", title: "Bee" }] },
			},
			widget: "radio",
			labels: ["a", "Bee"],
			selected: "b",
		},
		{
			schema: {
				type: "integer",
				enum: [1, 2],
				"x-formbar": {
					widget: "radio",
					props: { options: ["rogue"] },
					options: [
						{ value: "2", title: "Wrong type" },
						{ value: 2, title: "Two" },
					],
				},
			},
			widget: "radio",
			labels: ["1", "Two"],
			selected: 2,
		},
		{
			schema: {
				type: "boolean",
				enum: [false, true],
				"x-formbar": { widget: "radio", props: { options: ["rogue"] }, options: [{ value: true, title: "Yes" }] },
			},
			widget: "radio",
			labels: ["false", "Yes"],
			selected: true,
		},
	])(
		"does not render rogue $widget choices and submits canonical typed values",
		async ({ schema, widget, labels, selected }) => {
			const onSubmit = vi.fn();
			const view = mountForm({
				schema: { type: "object", properties: { choice: schema } },
				data: {},
				formOptions: { onSubmit },
			});
			mounted.push(view);
			expect(view.container.textContent).not.toContain("rogue");
			if (widget === "select") {
				const select = view.container.querySelector("select") as HTMLSelectElement;
				expect(Array.from(select.options).map((option) => option.textContent)).toEqual(["", ...labels]);
				change(select, "option-1");
			} else {
				const radios = view.container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
				expect(
					Array.from(view.container.querySelectorAll('input[type="radio"] + label')).map((label) => label.textContent),
				).toEqual(labels);
				act(() => radios[1].click());
			}
			expect(view.form.getState().data.choice).toBe(selected);
			expect(view.prepared.diagnostics.compilation).toContainEqual(
				expect.objectContaining({
					code: "unsupported-schema",
					message: expect.stringContaining("schema enum choices are authoritative"),
				}),
			);
			await act(async () => {
				await view.form.submit();
			});
			expect(onSubmit.mock.calls[0]?.[0].payload).toEqual({ choice: selected });
		},
	);

	it("keeps a bare enum's canonical renderer choices without decoration", () => {
		const view = mountForm({
			schema: {
				type: "object",
				properties: { choice: { enum: ["lead", "qa"], "x-formbar": { props: { options: ["rogue"] } } } },
			},
			data: { choice: "lead" },
		});
		mounted.push(view);
		expect(Array.from(view.container.querySelectorAll("select option")).map((option) => option.textContent)).toEqual([
			"",
			"lead",
			"qa",
		]);
		expect(view.prepared.diagnostics.compilation).toContainEqual(
			expect.objectContaining({ code: "unsupported-schema" }),
		);
	});
	it("shows labels in enum order, stores values, blocks disabled choices, and leaves validation independent", async () => {
		const view = mountForm({
			schema: {
				type: "object",
				properties: {
					role: {
						type: "string",
						enum: ["lead", "dev", "qa"],
						"x-formbar": {
							options: [
								{ value: "lead", title: "Lead" },
								{ value: "qa", title: "Quality", disabled: true },
							],
						},
					},
				},
			},
			data: { role: "qa" },
		});
		mounted.push(view);
		const select = view.container.querySelector("select") as HTMLSelectElement;
		expect(Array.from(select.options).map((option) => option.textContent)).toEqual(["", "Lead", "dev", "Quality"]);
		expect(select.options[3].disabled).toBe(true);
		expect(select.value).toBe("option-2");
		change(select, "option-0");
		expect(view.form.getState().data.role).toBe("lead");
		change(select, "option-2");
		expect(view.form.getState().data.role).toBe("lead");
		expect(view.prepared.sourceValidator).toBeUndefined();
		expect(await view.form.validate()).toEqual([]);
	});

	it("renders typed radio and array item metadata with exact stored values", () => {
		const view = mountForm({
			schema: {
				type: "object",
				properties: {
					choices: {
						type: "array",
						items: {
							type: "integer",
							enum: [1, 2],
							"x-formbar": {
								widget: "radio",
								options: [
									{ value: 1, title: "One" },
									{ value: 2, title: "Two", disabled: true },
								],
							},
						},
					},
				},
			},
			data: { choices: [2] },
		});
		mounted.push(view);
		const radios = view.container.querySelectorAll<HTMLInputElement>('input[type="radio"]');
		expect(
			Array.from(view.container.querySelectorAll('input[type="radio"] + label')).map((label) => label.textContent),
		).toEqual(["One", "Two"]);
		expect(radios[1].checked).toBe(true);
		expect(radios[1].disabled).toBe(true);
		act(() => radios[0].click());
		expect(view.form.getState().data.choices).toEqual([1]);
		act(() => radios[1].click());
		expect(view.form.getState().data.choices).toEqual([1]);
	});

	it("keeps an options-only existing value visible and does not turn presentation into validation", async () => {
		const view = mountForm({
			schema: {
				type: "object",
				properties: { role: { type: "string", "x-formbar": { options: [{ value: "new", title: "New" }] } } },
			},
			data: { role: "legacy" },
		});
		mounted.push(view);
		const select = view.container.querySelector("select") as HTMLSelectElement;
		expect(Array.from(select.options).map((option) => option.textContent)).toEqual(["", "New", "legacy"]);
		expect(select.options[2].disabled).toBe(true);
		expect(select.value).toBe("option-1");
		expect(await view.form.validate()).toEqual([]);
		change(select, "option-0");
		expect(view.form.getState().data.role).toBe("new");
	});

	it.each(["disabled", "readOnly"] as const)("combines %s field policy with option disabled state", (policy) => {
		let restricted = false;
		const plugin: FormPlugin = {
			id: "policy",
			evaluate: () => ({ fieldPolicy: restricted ? [{ path: "role", [policy]: true }] : [] }),
		};
		const view = mountForm({
			schema: {
				type: "object",
				properties: {
					role: { type: "string", enum: ["a", "b"], "x-formbar": { options: [{ value: "b", disabled: true }] } },
					tick: { type: "number" },
				},
			},
			data: { role: "b", tick: 0 },
			formOptions: { plugins: [plugin] },
		});
		mounted.push(view);
		const select = view.container.querySelector("select") as HTMLSelectElement;
		act(() => {
			restricted = true;
			view.form.setValue("tick", 1);
		});
		expect(select.disabled).toBe(true);
		expect(select.value).toBe("option-1");
		change(select, "option-0");
		expect(view.form.getState().data.role).toBe("b");
		act(() => {
			restricted = false;
			view.form.setValue("tick", 2);
		});
		expect(select.disabled).toBe(false);
		expect(select.options[2].disabled).toBe(true);
	});
});
