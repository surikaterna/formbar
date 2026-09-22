// @vitest-environment jsdom
import type { FormDefinition } from "@formbar/declarative";
import { act } from "react";
import { describe, expect, it } from "vitest";
import { binding, mountForm } from "./renderer-test-utils.js";

const definition: FormDefinition = {
	version: 1,
	id: "collections",
	root: {
		type: "group",
		id: "root",
		children: [
			{
				type: "tabs",
				id: "tabs",
				tabs: [
					{
						id: "personal",
						label: "Personal",
						children: [{ type: "field", id: "name", binding: binding("name"), widget: "text" }],
					},
					{
						id: "contact",
						label: "Contact",
						children: [{ type: "field", id: "email", binding: binding("email"), widget: "email" }],
					},
				],
			},
			{
				type: "accordion",
				id: "accordion",
				items: [
					{
						id: "first",
						label: "First",
						children: [{ type: "field", id: "first-value", binding: binding("first"), widget: "text" }],
					},
					{
						id: "second",
						label: "Second",
						children: [{ type: "field", id: "second-value", binding: binding("second"), widget: "text" }],
					},
				],
			},
		],
	},
};

function mount() {
	return mountForm({
		schema: {
			type: "object",
			properties: {
				name: { type: "string" },
				email: { type: "string" },
				first: { type: "string" },
				second: { type: "string" },
			},
		},
		definition,
		data: { name: "Ada", email: "ada@example.test", first: "A", second: "B" },
	});
}

function key(element: Element, value: string): void {
	act(() => element.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true })));
}

describe("built-in tabs and accordion", () => {
	it("keeps every controlled tab panel mounted with one active content tree", () => {
		const view = mount();
		const tabs = [...view.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
		expect(tabs).toHaveLength(2);
		expect(tabs[0].getAttribute("aria-selected")).toBe("true");
		expect(tabs[0].tabIndex).toBe(0);
		expect(tabs[1].tabIndex).toBe(-1);
		const panels = [...view.container.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
		expect(panels).toHaveLength(2);
		expect(panels.map((panel) => panel.hidden)).toEqual([false, true]);
		for (const tab of tabs) expect(document.getElementById(tab.getAttribute("aria-controls") ?? "")).not.toBeNull();
		expect(panels[0].getAttribute("aria-labelledby")).toBe(tabs[0].id);

		key(tabs[0], "ArrowRight");
		expect(tabs[1].getAttribute("aria-selected")).toBe("true");
		expect(document.activeElement).toBe(tabs[1]);
		expect(panels.map((panel) => panel.hidden)).toEqual([true, false]);
		expect(panels[0].querySelector("input")).toBeNull();
		expect(view.container.querySelector('[role="tabpanel"] input')?.getAttribute("type")).toBe("email");
		key(tabs[1], "Home");
		expect(tabs[0].getAttribute("aria-selected")).toBe("true");
		key(tabs[0], "End");
		expect(tabs[1].getAttribute("aria-selected")).toBe("true");
		view.unmount();
	});

	it("supports independent expansion and header focus keys with labelled regions", () => {
		const view = mount();
		const headers = [
			...view.container.querySelectorAll<HTMLButtonElement>('[data-formbar-node="accordion"] h3 button'),
		];
		expect(headers.map((header) => header.getAttribute("aria-expanded"))).toEqual(["true", "false"]);
		const initialRegions = [
			...view.container.querySelectorAll<HTMLElement>('[data-formbar-node="accordion"] [role="region"]'),
		];
		expect(initialRegions).toHaveLength(2);
		expect(initialRegions.map((region) => region.hidden)).toEqual([false, true]);
		for (const header of headers)
			expect(document.getElementById(header.getAttribute("aria-controls") ?? "")).not.toBeNull();
		act(() => headers[1].click());
		expect(headers.map((header) => header.getAttribute("aria-expanded"))).toEqual(["true", "true"]);
		const regions = [...view.container.querySelectorAll('[data-formbar-node="accordion"] [role="region"]')];
		expect(regions).toHaveLength(2);
		expect(regions.every((region) => !(region as HTMLElement).hidden)).toBe(true);
		expect(regions[1].getAttribute("aria-labelledby")).toBe(headers[1].id);
		expect(headers[1].getAttribute("aria-controls")).toBe(regions[1].id);
		headers[0].focus();
		key(headers[0], "ArrowDown");
		expect(document.activeElement).toBe(headers[1]);
		key(headers[1], "ArrowUp");
		expect(document.activeElement).toBe(headers[0]);
		key(headers[0], "End");
		expect(document.activeElement).toBe(headers[1]);
		view.unmount();
	});

	it("retains hidden panel and collapsed values in core state", () => {
		const view = mount();
		expect(view.form.getState().data).toEqual({
			name: "Ada",
			email: "ada@example.test",
			first: "A",
			second: "B",
		});
		view.unmount();
	});
});
