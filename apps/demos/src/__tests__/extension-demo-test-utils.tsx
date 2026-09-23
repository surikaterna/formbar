// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { SchemaDemoFixture } from "../demos/baseline-contracts";
import { SchemaDemoHost } from "../renderers/SchemaDemoHost";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

export interface MountedDemo {
	readonly container: HTMLDivElement;
	readonly root: Root;
}

const mounted: MountedDemo[] = [];

export async function mountDemo(
	fixture: SchemaDemoFixture,
	onSubmit?: (payload: Readonly<Record<string, unknown>>) => void,
	strict = false,
): Promise<MountedDemo> {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const host = <SchemaDemoHost fixture={fixture} onSubmit={onSubmit} />;
	await act(async () => {
		root.render(strict ? <StrictMode>{host}</StrictMode> : host);
		await Promise.resolve();
	});
	const view = { container, root };
	mounted.push(view);
	return view;
}

export function cleanupDemos(): void {
	for (const view of mounted.splice(0)) {
		act(() => view.root.unmount());
		view.container.remove();
	}
	document.body.replaceChildren();
}

export function labelled(view: MountedDemo, text: string): HTMLElement {
	const label = [...view.container.querySelectorAll("label")].find(
		(candidate) => candidate.textContent?.trim() === text,
	);
	const element = label?.htmlFor
		? document.getElementById(label.htmlFor)
		: label?.querySelector("input,select,textarea");
	if (!(element instanceof HTMLElement)) throw new Error(`Missing control labelled ${text}`);
	return element;
}

export function setInput(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
	act(() => {
		const prototype =
			element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
		Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
		element.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

export function setSelect(element: HTMLSelectElement, value: string): void {
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(element, value);
		element.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

export function selector(view: MountedDemo, label: string): HTMLSelectElement {
	const wrapper = [...view.container.querySelectorAll("label")].find((candidate) =>
		candidate.textContent?.includes(label),
	);
	const select = wrapper?.querySelector("select");
	if (!(select instanceof HTMLSelectElement)) throw new Error(`Missing ${label} selector`);
	return select;
}

export function button(view: MountedDemo, text: string): HTMLButtonElement {
	const found = [...view.container.querySelectorAll("button")].find(
		(candidate) => candidate.textContent?.trim() === text || candidate.getAttribute("aria-label") === text,
	);
	if (!found) throw new Error(`Missing button ${text}`);
	return found;
}

export async function click(element: HTMLElement): Promise<void> {
	await act(async () => {
		element.click();
		await Promise.resolve();
	});
}

export async function submit(view: MountedDemo): Promise<void> {
	await click(button(view, "Submit"));
}

export function resultJson(view: MountedDemo): string | undefined {
	const heading = [...view.container.querySelectorAll("h2")].find(
		(candidate) => candidate.textContent === "Last successful submission",
	);
	return heading?.parentElement?.querySelector("pre")?.textContent ?? undefined;
}

export function keyDown(element: HTMLElement, key: string): void {
	act(() => element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
}
