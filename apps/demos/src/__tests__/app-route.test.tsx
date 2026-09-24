// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { demos } from "../demos/registry";
import { exampleVariant, getPlaygroundExamples } from "../playground/examples";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
	if (root) act(() => root?.unmount());
	container?.remove();
	root = undefined;
	container = undefined;
	window.localStorage.clear();
});

function mount(url: string): HTMLDivElement {
	window.history.replaceState(null, "", url);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	act(() => root?.render(<App />));
	return container;
}

function button(view: HTMLElement, text: string): HTMLButtonElement {
	const match = [...view.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(text));
	if (!match) throw new Error(`Missing button ${text}`);
	return match;
}

function setInput(view: HTMLElement, labelText: string, value: string): void {
	const label = [...view.querySelectorAll("label")].find((candidate) => candidate.textContent === labelText);
	const input = label?.htmlFor ? document.getElementById(label.htmlFor) : undefined;
	if (!(input instanceof HTMLInputElement)) throw new Error(`Missing input ${labelText}`);
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

function setEditor(view: HTMLElement, value: string): void {
	const editor = view.querySelector("#source-schema");
	if (!(editor instanceof HTMLTextAreaElement)) throw new Error("Missing schema editor");
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(editor, value);
		editor.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

function panel(view: HTMLElement, heading: string): HTMLElement {
	const title = [...view.querySelectorAll("h2")].find((candidate) => candidate.textContent === heading);
	if (!(title?.parentElement instanceof HTMLElement)) throw new Error(`Missing panel ${heading}`);
	return title.parentElement;
}

async function traverseHistory(move: () => void): Promise<void> {
	await act(async () => {
		const popped = new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
		move();
		await popped;
	});
}

describe("App registry-derived routes", () => {
	it("resolves every numbered demo directly in numeric order", () => {
		const numbered = demos.filter(({ number }) => number !== undefined);
		const view = mount(`/?mode=demo&demo=${numbered[0].id}`);
		for (const demo of numbered) {
			act(() => {
				window.history.pushState(null, "", `/?mode=demo&demo=${demo.id}`);
				window.dispatchEvent(new PopStateEvent("popstate"));
			});
			expect(view.textContent, demo.id).toContain(demo.title);
			expect(button(view, "Open in Playground"), demo.id).toBeDefined();
		}
	});

	it("deep-links every playground example through the production renderer", () => {
		const view = mount("/?mode=playground&demo=basic-contact");
		for (const example of getPlaygroundExamples()) {
			const variant = exampleVariant(example);
			act(() => {
				window.history.pushState(null, "", `/?mode=playground&demo=${example.demoId}&preset=${variant}`);
				window.dispatchEvent(new PopStateEvent("popstate"));
			});
			expect(view.textContent, example.key).toContain("Interactive playground");
			if (!example.runtime.arbiterRules) expect(view.querySelector("form"), example.key).not.toBeNull();
		}
	});

	it("canonicalizes invalid IDs and presets without dropping unrelated URL state", () => {
		const view = mount("/formbar/?theme=dark&mode=playground&demo=missing&preset=bogus#docs");
		expect(view.textContent).toContain("Interactive playground");
		expect(window.location.pathname).toBe("/formbar/");
		expect(window.location.hash).toBe("#docs");
		expect(window.location.search).toBe("?theme=dark&mode=playground&demo=basic-contact&preset=default");
	});

	it("opens from a demo and closes back to the same demo", () => {
		const view = mount("/?mode=demo&demo=custom-renderers");
		act(() => button(view, "Open in Playground").click());
		expect(window.location.search).toBe("?mode=playground&demo=custom-renderers&preset=schema-hints");
		expect(view.textContent).toContain("Interactive playground");
		act(() => button(view, "← Demo").click());
		expect(window.location.search).toBe("?mode=demo&demo=custom-renderers");
		expect(view.textContent).toContain("16. Custom Renderers");
	});

	it("keeps playground navigation in browser back and forward history", async () => {
		const view = mount("/?mode=demo&demo=basic-contact");
		act(() => button(view, "Open in Playground").click());
		expect(view.textContent).toContain("Interactive playground");
		await traverseHistory(() => window.history.back());
		expect(window.location.search).toBe("?mode=demo&demo=basic-contact");
		await traverseHistory(() => window.history.forward());
		expect(window.location.search).toBe("?mode=playground&demo=basic-contact&preset=default");
	});

	it("retains the exact live form, data, and successful result across invalid schema apply, then recovers", async () => {
		const view = mount("/?mode=playground&demo=basic-contact");
		const form = view.querySelector("form");
		const editor = view.querySelector("#source-schema");
		if (!(form instanceof HTMLFormElement) || !(editor instanceof HTMLTextAreaElement)) {
			throw new Error("Missing playground runtime");
		}
		const validSchema = editor.value;
		setInput(view, "Full Name", "Last Valid");
		setInput(view, "Email", "last-valid@example.com");
		await act(async () => {
			button(view, "Submit").click();
			await Promise.resolve();
		});
		const successful = panel(view, "Last successful submission").querySelector("pre")?.textContent;
		expect(successful).toContain('"name": "Last Valid"');

		setEditor(view, '{"type":"object","minProperties":-1}');
		act(() => button(view, "Apply").click());
		expect(view.querySelector('[role="alert"]')?.textContent).toContain("Schema is not valid Draft 2020-12");
		expect(view.textContent).toContain("Apply failed; review source errors.");
		expect(view.querySelector("form")).toBe(form);
		expect(panel(view, "Current form data").textContent).toContain('"name": "Last Valid"');
		expect(panel(view, "Last successful submission").querySelector("pre")?.textContent).toBe(successful);

		setEditor(view, validSchema);
		act(() => button(view, "Apply").click());
		expect(view.querySelector('[role="alert"]')).toBeNull();
		expect(view.textContent).toContain("Document applied.");
		expect(view.querySelector("form")).not.toBe(form);
	});
});
