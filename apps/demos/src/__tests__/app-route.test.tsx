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
		expect(window.location.search).toBe("?mode=playground&demo=basic-contact");
	});
});
