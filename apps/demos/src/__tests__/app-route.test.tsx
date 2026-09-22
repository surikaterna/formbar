// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../App";

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

describe("App route history", () => {
	it("canonicalizes a direct unsupported playground load to normal demo mode", () => {
		const view = mount("/?mode=playground&demo=basic-contact&preset=fallback");
		expect(view.textContent).toContain("1. Basic Contact Form");
		expect(view.textContent).not.toContain("Compilation playground");
		expect(window.location.search).toBe("?mode=demo&demo=basic-contact");
	});

	it("navigates the compatible compilation demo into its valid playground", () => {
		const view = mount("/?mode=demo&demo=basic-contact");
		act(() => button(view, "Compilation preview").click());
		expect(window.location.search).toBe("?mode=demo&demo=schema-compilation");
		act(() => button(view, "Open compilation playground").click());
		expect(window.location.search).toBe("?mode=playground&demo=schema-compilation");
		expect(view.textContent).toContain("Compilation playground");
	});

	it("canonicalizes unsupported playground state received through popstate", () => {
		const view = mount("/?mode=playground&demo=schema-compilation");
		expect(view.textContent).toContain("Compilation playground");
		act(() => {
			window.history.pushState(null, "", "/?mode=playground&demo=basic-contact");
			window.dispatchEvent(new PopStateEvent("popstate"));
		});
		expect(view.textContent).toContain("1. Basic Contact Form");
		expect(view.textContent).not.toContain("Compilation playground");
		expect(window.location.search).toBe("?mode=demo&demo=basic-contact");
	});
});
