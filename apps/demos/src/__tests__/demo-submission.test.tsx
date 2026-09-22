// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { basicContactDemo } from "../demos/01-basic-contact";
import { multiSchemaSourcesDemo } from "../demos/13-multi-schema-sources";
import type { SchemaDemoFixture } from "../demos/baseline-contracts";
import { SchemaDemoHost } from "../renderers/SchemaDemoHost";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface MountedHost {
	readonly container: HTMLDivElement;
	readonly root: Root;
}

const mounted: MountedHost[] = [];
const nestedSnapshotFixture: SchemaDemoFixture = {
	id: "nested-snapshot",
	title: "Nested snapshot",
	subtitle: "Test fixture",
	copy: "Test fixture",
	category: "baseline",
	sources: [
		{
			key: "default",
			label: "Nested schema",
			schema: {
				type: "object",
				properties: { profile: { type: "object", properties: { name: { type: "string" } } } },
			},
			initialData: { profile: { name: "Ada" } },
		},
	],
};

afterEach(() => {
	for (const view of mounted.splice(0)) {
		act(() => view.root.unmount());
		view.container.remove();
	}
	vi.restoreAllMocks();
});

function mount(fixture: SchemaDemoFixture, onSubmit = vi.fn()): MountedHost {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	act(() => root.render(<SchemaDemoHost fixture={fixture} onSubmit={onSubmit} />));
	const view = { container, root };
	mounted.push(view);
	return view;
}

function input(view: MountedHost, labelText: string, value: string): void {
	const label = [...view.container.querySelectorAll("label")].find((candidate) => candidate.textContent === labelText);
	const element = label?.htmlFor ? document.getElementById(label.htmlFor) : undefined;
	if (!(element instanceof HTMLInputElement)) throw new Error(`Missing input ${labelText}`);
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
		element.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

function changeSource(view: MountedHost, source: string): void {
	const select = view.container.querySelector("header select");
	if (!(select instanceof HTMLSelectElement)) throw new Error("Missing source selector");
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, source);
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

async function submit(view: MountedHost): Promise<void> {
	const button = [...view.container.querySelectorAll("button")].find(
		(candidate) => candidate.textContent?.trim() === "Submit",
	);
	if (!button) throw new Error("Missing Submit button");
	await act(async () => {
		button.click();
		await Promise.resolve();
	});
}

async function reset(view: MountedHost): Promise<void> {
	const button = [...view.container.querySelectorAll("button")].find(
		(candidate) => candidate.textContent?.trim() === "Reset",
	);
	if (!button) throw new Error("Missing Reset button");
	await act(async () => button.click());
}

function submissionRegion(view: MountedHost): HTMLElement {
	const heading = [...view.container.querySelectorAll("h2")].find(
		(candidate) => candidate.textContent === "Last successful submission",
	);
	if (!(heading?.parentElement instanceof HTMLElement)) throw new Error("Missing submission region");
	return heading.parentElement;
}

describe("schema demo submission boundary", () => {
	it("suppresses onSubmit for invalid data and bypasses native DOM validity", async () => {
		const onSubmit = vi.fn();
		const checkValidity = vi.spyOn(HTMLFormElement.prototype, "checkValidity");
		const reportValidity = vi.spyOn(HTMLFormElement.prototype, "reportValidity");
		const view = mount(basicContactDemo, onSubmit);
		const form = view.container.querySelector("form");
		expect(form?.noValidate).toBe(true);
		expect(form?.hasAttribute("novalidate")).toBe(true);
		expect(submissionRegion(view).getAttribute("aria-live")).toBe("polite");
		expect(submissionRegion(view).textContent).toContain("No successful submission yet.");

		await submit(view);
		expect(onSubmit).not.toHaveBeenCalled();
		expect(view.container.querySelector("[data-formbar-error-summary]")?.textContent).toContain(
			'Required property "email" is missing.',
		);
		expect(checkValidity).not.toHaveBeenCalled();
		expect(reportValidity).not.toHaveBeenCalled();
	});

	it("snapshots success once and preserves it through edits, invalid submit, and reset", async () => {
		const onSubmit = vi.fn();
		const view = mount(basicContactDemo, onSubmit);
		input(view, "Full Name", "Ada Lovelace");
		input(view, "Email", "ada@example.com");
		await submit(view);

		expect(onSubmit).toHaveBeenCalledTimes(1);
		const payload = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
		expect(payload).toEqual({ name: "Ada Lovelace", email: "ada@example.com" });
		expect(Object.isFrozen(payload)).toBe(true);
		const successfulJson = submissionRegion(view).querySelector("pre")?.textContent;
		expect(successfulJson).toBe('{\n  "name": "Ada Lovelace",\n  "email": "ada@example.com"\n}');

		input(view, "Email", "not-an-email");
		expect(submissionRegion(view).querySelector("pre")?.textContent).toBe(successfulJson);
		await submit(view);
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(view.container.querySelector("[data-formbar-error-summary]")?.textContent).toContain(
			'Must match the "email" format.',
		);
		expect(submissionRegion(view).querySelector("pre")?.textContent).toBe(successfulJson);

		await reset(view);
		expect(submissionRegion(view).querySelector("pre")?.textContent).toBe(successfulJson);
	});

	it("uses the selected source validator and resets result history on source remount", async () => {
		const onSubmit = vi.fn();
		const view = mount(multiSchemaSourcesDemo, onSubmit);
		await submit(view);
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(submissionRegion(view).querySelector("pre")?.textContent).toBe("{}");

		changeSource(view, "explicit");
		expect(submissionRegion(view).textContent).toContain("No successful submission yet.");
		await submit(view);
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(submissionRegion(view).querySelector("pre")).toBeNull();
		expect(view.container.querySelector("[data-formbar-error-summary]")).not.toBeNull();
	});

	it("starts new result history when the demo remount key changes", async () => {
		const onSubmit = vi.fn();
		const view = mount(multiSchemaSourcesDemo, onSubmit);
		await submit(view);
		expect(submissionRegion(view).querySelector("pre")?.textContent).toBe("{}");

		act(() => view.root.render(<SchemaDemoHost fixture={basicContactDemo} onSubmit={onSubmit} />));
		expect(submissionRegion(view).textContent).toContain("No successful submission yet.");
		expect(submissionRegion(view).querySelector("pre")).toBeNull();
	});

	it("deep-freezes the captured payload snapshot", async () => {
		const onSubmit = vi.fn();
		const view = mount(nestedSnapshotFixture, onSubmit);
		await submit(view);
		const payload = onSubmit.mock.calls[0]?.[0] as { readonly profile: { readonly name: string } };
		expect(Object.isFrozen(payload)).toBe(true);
		expect(Object.isFrozen(payload.profile)).toBe(true);
		expect(payload.profile.name).toBe("Ada");
	});
});
