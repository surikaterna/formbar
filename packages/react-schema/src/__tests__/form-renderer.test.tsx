// @vitest-environment jsdom
import type { FormDefinition } from "@formbar/declarative";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { binding, literal, mountForm } from "./renderer-test-utils.js";

const mounted: Array<ReturnType<typeof mountForm<Record<string, unknown>>>> = [];
afterEach(() => {
	for (const item of mounted.splice(0)) item.unmount();
});

describe("FormRenderer", () => {
	it("renders semantic containers, validation nodes, and exact responsive output", () => {
		const definition: FormDefinition = {
			version: 1,
			id: "structure",
			root: {
				type: "group",
				id: "root",
				label: "Profile",
				children: [
					{
						type: "section",
						id: "details",
						title: "Details",
						description: "Public data",
						presentation: { span: { base: "full", sm: 6, md: "auto", lg: 4, xl: 3 } },
						children: [{ type: "field", id: "name", binding: binding("name"), widget: "text" }],
					},
					{ type: "validation", id: "name-validation", binding: binding("name"), messages: ["Fix the name"] },
				],
			},
		};
		const view = mount({ definition, data: { name: "Ada" }, schema: objectSchema({ name: { type: "string" } }) });
		expect(view.container.querySelector("form[novalidate]")).not.toBeNull();
		expect(view.container.querySelector("fieldset > legend")?.textContent).toBe("Profile");
		expect(view.container.querySelector("section h2")?.textContent).toBe("Details");
		const section = view.container.querySelector("section") as HTMLElement;
		expect(section.getAttribute("data-formbar-span-base")).toBe("12");
		expect(section.getAttribute("data-formbar-span-sm")).toBe("6");
		expect(section.getAttribute("data-formbar-span-md")).toBe("auto");
		expect(section.getAttribute("data-formbar-span-lg")).toBe("4");
		expect(section.getAttribute("data-formbar-span-xl")).toBe("3");
		expect(section.style.getPropertyValue("--formbar-span-base")).toBe("12");
		expect(section.style.getPropertyValue("--formbar-span-md")).toBe("auto");
	});

	it("reacts to conditionals while retaining hidden core data", () => {
		const definition: FormDefinition = {
			version: 1,
			id: "conditional",
			root: {
				type: "conditional",
				id: "choice",
				condition: { kind: "ref", ref: binding("show") },
				// biome-ignore lint/suspicious/noThenProperty: Declarative conditionals require the `then` contract key.
				then: [{ type: "field", id: "secret", binding: binding("secret"), widget: "text" }],
				else: [{ type: "field", id: "alternate", binding: binding("alternate"), widget: "text" }],
			},
		};
		const view = mount({
			definition,
			data: { show: true, secret: "retained", alternate: "other" },
			schema: objectSchema({ show: { type: "boolean" }, secret: { type: "string" }, alternate: { type: "string" } }),
		});
		expect(view.container.querySelector('[data-formbar-node="secret"]')).not.toBeNull();
		act(() => view.form.setValue("show", false));
		expect(view.container.querySelector('[data-formbar-node="secret"]')).toBeNull();
		expect(view.container.querySelector('[data-formbar-node="alternate"]')).not.toBeNull();
		expect(view.form.getState().data.secret).toBe("retained");
	});

	it("emits deterministic diagnostics for every unsupported category", () => {
		const definition: FormDefinition = {
			version: 1,
			id: "fallbacks",
			root: {
				type: "group",
				id: "root",
				children: [
					{
						type: "repeater",
						id: "repeater",
						binding: binding("list"),
						scope: "item",
						children: [
							{
								type: "field",
								id: "item",
								binding: { namespace: "data", scope: "item", segments: [] },
								widget: "text",
							},
						],
					},
					{ type: "action", id: "action", action: "save" },
					{ type: "output", id: "output", value: { kind: "literal", value: "summary" } },
					{ type: "tabs", id: "tabs", tabs: [{ id: "tab", label: "Tab", children: [] }] },
					{ type: "accordion", id: "accordion", items: [{ id: "panel", label: "Panel", children: [] }] },
					{ type: "custom", id: "custom", renderer: "private" },
					{ type: "field", id: "widget", binding: binding("name"), widget: "slider" },
					{ type: "field", id: "root-value", binding: binding(), widget: "text" },
					{
						type: "field",
						id: "unsafe-ui",
						binding: { namespace: "ui", segments: ["bad.key"] },
						widget: "text",
					},
					{
						type: "field",
						id: "bad-options",
						binding: binding("choice"),
						widget: "select",
						props: { options: { mode: "literal", value: { secret: true } } },
					},
					{
						type: "conditional",
						id: "broken-condition",
						condition: { kind: "ref", ref: binding("missing") },
						// biome-ignore lint/suspicious/noThenProperty: Declarative conditionals require the `then` contract key.
						then: [],
					},
				],
			},
		};
		const view = mount({
			definition,
			data: { name: "Ada", choice: "x", list: ["one"] },
			uiState: { "bad.key": "hidden" },
			schema: objectSchema({
				name: { type: "string" },
				choice: { type: "string" },
				list: { type: "array", items: { type: "string" } },
			}),
		});
		const codes = [...view.container.querySelectorAll("[data-formbar-diagnostic]")].map((node) =>
			node.getAttribute("data-formbar-diagnostic"),
		);
		expect(codes).toEqual([
			"unsupported-node",
			"unsupported-node",
			"unsupported-node",
			"unsupported-node",
			"unsupported-node",
			"unsupported-node",
			"unsupported-widget",
			"unsupported-binding",
			"unsupported-binding",
			"unsupported-options",
			"conditional-unresolved",
		]);
		expect(view.container.textContent).not.toContain("private");
	});
});

function mount(options: Parameters<typeof mountForm<Record<string, unknown>>>[0]) {
	const view = mountForm(options);
	mounted.push(view);
	return view;
}

function objectSchema(properties: Record<string, unknown>) {
	return { type: "object", properties };
}
