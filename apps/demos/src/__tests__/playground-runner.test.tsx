// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { PlaygroundRunner } from "../playground/PlaygroundRunner";
import { getPlaygroundExamples } from "../playground/examples";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => document.body.replaceChildren());

function currentData(container: HTMLElement): string {
	const heading = [...container.querySelectorAll("h2")].find(({ textContent }) => textContent === "Current form data");
	return heading?.parentElement?.querySelector("pre")?.textContent ?? "";
}

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
	it("renders every projected example through the production form path", async () => {
		for (const example of getPlaygroundExamples()) {
			const container = document.createElement("div");
			document.body.append(container);
			const root = createRoot(container);
			await act(async () => {
				root.render(<PlaygroundRunner document={example.document} runtime={example.runtime} />);
				await Promise.resolve();
			});
			expect(container.querySelector("form"), example.key).not.toBeNull();
			expect(container.textContent, example.key).toContain("Preparation diagnostics");
			const before = currentData(container);
			act(() => {
				if (!changeFirstControl(container)) return;
			});
			if (container.querySelector("input, select, textarea"))
				expect(currentData(container), example.key).not.toBe(before);
			else expect(container.querySelector("[data-formbar-diagnostic]"), example.key).not.toBeNull();
			act(() => root.unmount());
			container.remove();
		}
	});

	it("exposes separately labeled live state, issues, preparation, renderer, and successful-result regions", () => {
		const example = getPlaygroundExamples()[0];
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		act(() => root.render(<PlaygroundRunner document={example.document} runtime={example.runtime} />));
		expect(container.textContent).toContain("Current form data");
		expect(container.textContent).toContain("Core issues and submission status");
		expect(container.textContent).toContain("Preparation diagnostics");
		expect(container.textContent).toContain("Last successful submission");
		expect(container.textContent).toContain("Interactive form and runtime diagnostics");
		act(() => root.unmount());
	});
});
