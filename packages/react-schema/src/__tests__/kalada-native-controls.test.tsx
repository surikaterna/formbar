// @vitest-environment jsdom
import type { KaladaV1Control } from "@formbar/declarative";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { nativeControl } from "../kalada-native-controls.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const dispose: Array<() => void> = [];
afterEach(() => {
	for (const close of dispose.splice(0)) close();
});

function mount(rendererId: string, value: KaladaV1Control["value"], options?: KaladaV1Control["props"]) {
	const write = vi.fn(() => ({ status: "applied" }));
	const control: KaladaV1Control = {
		path: "root",
		nodeId: "choice",
		key: "host-row-key",
		type: "field",
		rendererId,
		visible: true,
		disabled: false,
		readOnly: false,
		value,
		props: options ?? {},
		writers: { value: write },
	};
	const container = document.createElement("div");
	const root = createRoot(container);
	act(() => root.render(nativeControl(control)));
	dispose.push(() => act(() => root.unmount()));
	return { container, write };
}

it("preserves typed choice identity, blocks disabled options, and labels radio choices", () => {
	const options = {
		options: [
			{ value: 1, title: "One" },
			{ value: false, title: "Off" },
			{ value: null, disabled: true },
		],
	};
	const selected = mount("select", 1, options);
	const select = selected.container.querySelector("select");
	expect(select?.value).toBe("0");
	expect(select?.options[2]?.disabled).toBe(true);
	act(() => {
		if (select) {
			select.value = "1";
			select.dispatchEvent(new Event("change", { bubbles: true }));
		}
	});
	expect(selected.write).toHaveBeenCalledWith(false);
	const radio = mount("radio", false, options);
	expect(radio.container.querySelector('[role="radiogroup"]')?.getAttribute("aria-labelledby")).toContain("-label");
	expect(radio.container.querySelectorAll('input[type="radio"]')[2]?.hasAttribute("disabled")).toBe(true);
	act(() => radio.container.querySelector<HTMLInputElement>('input[type="radio"]')?.click());
	expect(radio.write).toHaveBeenCalledWith(1);
});

it("renders text, textarea, checkbox, numeric and date controls with host writers", () => {
	for (const [widget, value, expected] of [
		["text", "original", "text"],
		["textarea", "original", "textarea"],
		["checkbox", true, "checkbox"],
		["number", 4, "number"],
		["date", "2026-09-29", "date"],
	] as const) {
		const { container } = mount(widget, value);
		expect(container.querySelector(expected === "textarea" ? "textarea" : `input[type="${expected}"]`)).not.toBeNull();
	}
});
