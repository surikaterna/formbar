// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { PlaygroundRunner } from "../playground/PlaygroundRunner";
import { getPlaygroundExamples } from "../playground/examples";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => document.body.replaceChildren());

function changeFirstControl(container: HTMLElement): boolean {
	const control = container.querySelector("input, select, textarea");
	if (control instanceof HTMLInputElement) {
		if (control.type === "checkbox" || control.type === "radio") control.click();
		else {
			const value = control.type === "number" || control.type === "range" ? "2" : "playground-value";
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(control, value);
			control.dispatchEvent(new Event("input", { bubbles: true }));
		}
		return true;
	}
	if (control instanceof HTMLSelectElement) {
		const option = [...control.options].find(({ value }) => value !== control.value);
		if (!option) return false;
		Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(control, option.value);
		control.dispatchEvent(new Event("change", { bubbles: true }));
		return true;
	}
	if (control instanceof HTMLTextAreaElement) {
		Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(control, "playground-value");
		control.dispatchEvent(new Event("input", { bubbles: true }));
		return true;
	}
	return false;
}

describe("interactive playground runner", () => {
	it("renders the supported schema-only fixture through the installed writable host", async () => {
		for (const example of getPlaygroundExamples().filter(({ key }) => key === "basic-contact:schema-options")) {
			const container = document.createElement("div");
			document.body.append(container);
			const root = createRoot(container);
			await act(async () => {
				root.render(<PlaygroundRunner document={example.document} runtime={example.runtime} />);
				await Promise.resolve();
			});
			expect(container.querySelector("form"), example.key).not.toBeNull();
			const before = container.querySelector("form select")?.value;
			act(() => {
				if (!changeFirstControl(container)) return;
			});
			expect(container.querySelector("form select")?.value, example.key).not.toBe(before);
			act(() => root.unmount());
			container.remove();
		}
	});

	it("exposes a successful-result region without claiming legacy preparation diagnostics", () => {
		const example = getPlaygroundExamples().find(({ key }) => key === "basic-contact:schema-options");
		if (!example) throw new Error("Missing supported schema-only example");
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		act(() => root.render(<PlaygroundRunner document={example.document} runtime={example.runtime} />));
		expect(container.querySelector("form")).not.toBeNull();
		expect(container.textContent).not.toContain("Preparation diagnostics");
		expect(container.textContent).toContain("Last successful submission");
		act(() => root.unmount());
	});
});
