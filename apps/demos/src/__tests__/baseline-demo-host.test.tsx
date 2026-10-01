// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { basicContactDemo } from "../demos/01-basic-contact";
import { nestedAddressDemo } from "../demos/03-nested-address";
import { multiSchemaSourcesDemo } from "../demos/13-multi-schema-sources";
import type { SchemaDemoFixture } from "../demos/baseline-contracts";
import { SchemaDemoHost } from "../renderers/SchemaDemoHost";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mounted: { root: ReturnType<typeof createRoot>; container: HTMLDivElement }[] = [];
afterEach(() => {
	for (const { root, container } of mounted.splice(0)) {
		act(() => root.unmount());
		container.remove();
	}
});

function mount(fixture: SchemaDemoFixture, onSubmit = vi.fn()) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	mounted.push({ root, container });
	act(() => root.render(<SchemaDemoHost fixture={fixture} onSubmit={onSubmit} />));
	return { container, onSubmit };
}

function edit(container: HTMLElement, label: string, value: string) {
	const control = [...container.querySelectorAll("label")].find((node) => node.textContent === label)?.control;
	if (!(control instanceof HTMLInputElement)) throw new Error(`Missing ${label}`);
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(control, value);
		control.dispatchEvent(new Event("change", { bubbles: true }));
	});
	return control;
}

async function submit(container: HTMLElement) {
	await act(async () => {
		container.querySelector<HTMLButtonElement>('form button[type="submit"]')?.click();
		await Promise.resolve();
	});
}

describe("app-installed baseline host", () => {
	it("validates schema-required generated contact controls, edits, submits and resets", async () => {
		const { container, onSubmit } = mount(basicContactDemo);
		expect(container.querySelector("form[data-kalada-v1]")).not.toBeNull();
		await submit(container);
		expect(onSubmit).not.toHaveBeenCalled();
		expect(container.querySelector("[data-kalada-issue-summary]")?.textContent).toContain("email");
		const name = edit(container, "Full Name", "Ada");
		edit(container, "Email", "ada@example.com");
		await submit(container);
		expect(onSubmit).toHaveBeenCalledWith({ name: "Ada", email: "ada@example.com" });
		act(() => container.querySelector<HTMLButtonElement>('button[type="button"]')?.click());
		expect(name.value).toBe("");
	});

	it("renders nested authored sections and editable schema-enumerated choices", () => {
		const { container } = mount(nestedAddressDemo);
		expect([...container.querySelectorAll("form h2")].map((node) => node.textContent)).toEqual([
			"Home Address",
			"Work Address",
		]);
		const selects = [...container.querySelectorAll("form select")];
		expect(selects).toHaveLength(2);
		expect(selects[0].textContent).toContain("United Kingdom");
	});

	it("remounts generated controls when the selected schema source changes", () => {
		const { container } = mount(multiSchemaSourcesDemo);
		const chooser = container.querySelector("header select");
		if (!(chooser instanceof HTMLSelectElement)) throw new Error("Missing schema chooser");
		act(() => {
			chooser.value = "explicit";
			chooser.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect([...container.querySelectorAll("form label")].map((label) => label.textContent)).toContain("Full Name");
	});
});
