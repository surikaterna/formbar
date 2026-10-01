// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { conditionalFieldsDemo } from "../demos/07-conditional-fields";
import { surveyDemo } from "../demos/12-survey-questionnaire";
import { arbiterVisibilityDemo } from "../demos/18-arbiter-visibility";
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
	expect(container.querySelector("form[data-kalada-v1]"), container.textContent ?? "").not.toBeNull();
	return { container, onSubmit };
}

function choose(container: HTMLElement, label: string) {
	const radio = [...container.querySelectorAll("form label")]
		.find((item) => item.textContent === label)
		?.querySelector<HTMLInputElement>('input[type="radio"]');
	if (!radio) throw new Error(`Missing ${label} choice`);
	act(() => radio.click());
}

function edit(container: HTMLElement, label: string, value: string) {
	const control = [...container.querySelectorAll("label")].find((item) => item.textContent === label)?.control;
	if (!(control instanceof HTMLInputElement)) throw new Error(`Missing ${label}`);
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(control, value);
		control.dispatchEvent(new Event("change", { bubbles: true }));
	});
	return control;
}

describe("app-installed conditional host", () => {
	it("switches employment branches without losing hidden edited data", () => {
		const { container } = mount(conditionalFieldsDemo);
		choose(container, "Employed");
		expect(container.querySelector('[data-kalada-control="f-company-name"]')).not.toBeNull();
		edit(container, "Company Name", "Retained employer");
		choose(container, "Student");
		expect(container.querySelector('[data-kalada-control="f-school-name"]')).not.toBeNull();
		expect(container.querySelector('[data-kalada-control="f-company-name"]')).toBeNull();
		choose(container, "Employed");
		expect((container.querySelector('[data-kalada-control="f-company-name"] input') as HTMLInputElement).value).toBe(
			"Retained employer",
		);
	});

	it("requires follow-up email only in the selected survey branch before submission", async () => {
		const { container, onSubmit } = mount(surveyDemo);
		choose(container, "Very Satisfied");
		choose(container, "Definitely");
		const followUp = [...container.querySelectorAll("label")].find(
			(item) => item.textContent === "May We Contact You?",
		)?.control;
		if (!(followUp instanceof HTMLInputElement)) throw new Error("Missing follow-up control");
		act(() => followUp.click());
		expect(container.querySelector('[data-kalada-control="f-email"]')).not.toBeNull();
		await act(async () => {
			container.querySelector<HTMLButtonElement>('form button[type="submit"]')?.click();
			await Promise.resolve();
		});
		expect(onSubmit).not.toHaveBeenCalled();
		expect(container.querySelector("[data-kalada-issue-summary]")?.textContent).toContain("email");
		edit(container, "Email", "person@example.com");
		await act(async () => {
			container.querySelector<HTMLButtonElement>('form button[type="submit"]')?.click();
			await Promise.resolve();
		});
		expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ email: "person@example.com" }));
	});

	it("applies trusted Arbiter visibility to regional controls after country edits", () => {
		const { container } = mount(arbiterVisibilityDemo);
		const country = [...container.querySelectorAll("label")].find((item) => item.textContent === "Country")?.control;
		if (!(country instanceof HTMLSelectElement)) throw new Error("Missing Country select");
		const us = [...country.options].find((option) => option.textContent === "US");
		if (!us) throw new Error("Missing US option");
		act(() => {
			country.value = us.value;
			country.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(container.querySelector('[data-kalada-control="f-state"]')).not.toBeNull();
		expect(container.querySelector('[data-kalada-control="f-province"]')).toBeNull();
	});
});
