// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { basicContactDemo } from "../demos/01-basic-contact";
import { userProfileDemo } from "../demos/02-user-profile";
import { nestedAddressDemo } from "../demos/03-nested-address";
import { settingsPanelDemo } from "../demos/04-settings-panel";
import { productEntryDemo } from "../demos/05-product-entry";
import { customLayoutDemo } from "../demos/09-custom-layout";
import { responsiveSectionsDemo } from "../demos/10-multi-section-responsive";
import { multiSchemaSourcesDemo } from "../demos/13-multi-schema-sources";
import { kitchenSinkDemo } from "../demos/15-kitchen-sink";
import type { SchemaDemoFixture } from "../demos/baseline-contracts";
import { baselineFixtures } from "../demos/index";
import { SchemaDemoHost } from "../renderers/SchemaDemoHost";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface MountedHost {
	readonly container: HTMLDivElement;
	readonly root: Root;
}

const mounted: MountedHost[] = [];
afterEach(() => {
	for (const view of mounted.splice(0)) {
		act(() => view.root.unmount());
		view.container.remove();
	}
});

function mount(fixture: SchemaDemoFixture): MountedHost {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	act(() => root.render(<SchemaDemoHost fixture={fixture} />));
	const view = { container, root };
	mounted.push(view);
	return view;
}

function control(view: MountedHost, labelText: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
	const label = [...view.container.querySelectorAll("label")].find((candidate) => candidate.textContent === labelText);
	const element = label?.htmlFor ? document.getElementById(label.htmlFor) : label?.querySelector("input");
	if (
		!(
			element instanceof HTMLInputElement ||
			element instanceof HTMLTextAreaElement ||
			element instanceof HTMLSelectElement
		)
	) {
		throw new Error(`Missing control for ${labelText}`);
	}
	return element;
}

function input(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
	act(() => {
		const prototype =
			element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
		Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
		element.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

function change(element: HTMLSelectElement, value: string): void {
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(element, value);
		element.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

async function click(view: MountedHost, text: string): Promise<void> {
	const button = [...view.container.querySelectorAll("button")].find(
		(candidate) => candidate.textContent?.trim() === text,
	);
	if (!button) throw new Error(`Missing ${text} button`);
	await act(async () => {
		button.click();
		await Promise.resolve();
	});
}

describe("SchemaDemoHost routes", () => {
	it("renders all nine fixtures through a semantic production form", () => {
		for (const fixture of baselineFixtures) {
			const view = mount(fixture);
			expect(view.container.querySelector("form")?.getAttribute("data-formbar-definition"), fixture.id).toBeTruthy();
			expect(view.container.querySelector("[data-formbar-diagnostic]"), fixture.id).toBeNull();
		}
	});
});

describe("generated and schema-evidence behavior", () => {
	it("renders generated required, format, textarea, nested, and option controls", () => {
		const contact = mount(basicContactDemo);
		const name = control(contact, "Full Name") as HTMLInputElement;
		expect(name.required).toBe(true);
		input(name, "Updated contact");
		expect(name.value).toBe("Updated contact");
		expect((control(contact, "Email") as HTMLInputElement).type).toBe("email");
		expect(control(contact, "Message")).toBeInstanceOf(HTMLTextAreaElement);

		const addresses = mount(nestedAddressDemo);
		expect([...addresses.container.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual([
			"Home Address",
			"Work Address",
		]);
		const countries = [...addresses.container.querySelectorAll("select")];
		expect(countries).toHaveLength(2);
		expect([...countries[0].options].map((option) => option.textContent)).toContain("United Kingdom");
		change(countries[0], "option-0");
		expect(countries[0].selectedOptions[0].textContent).toBe("United States");
	});

	it("keeps select, checkbox, and constrained-number edits across renderer updates", () => {
		const profile = mount(userProfileDemo);
		const age = control(profile, "Age") as HTMLInputElement;
		expect([age.type, age.min, age.max, age.step]).toEqual(["number", "18", "120", "1"]);
		input(age, "42");
		expect(age.value).toBe("42");
		const department = control(profile, "Department") as HTMLSelectElement;
		change(department, "option-2");
		expect(department.selectedOptions[0].textContent).toBe("Marketing");

		const settings = mount(settingsPanelDemo);
		const fontSize = control(settings, "Font Size") as HTMLInputElement;
		expect([fontSize.min, fontSize.max, fontSize.step]).toEqual(["12", "24", "1"]);
		const analytics = control(settings, "Usage Analytics") as HTMLInputElement;
		act(() => analytics.click());
		expect(analytics.checked).toBe(true);
		const timeZone = control(settings, "Time Zone") as HTMLSelectElement;
		change(timeZone, "option-2");
		expect(timeZone.selectedOptions[0].textContent).toBe("UTC+0 (GMT)");
	});

	it("renders product constraints and authored vessel layout without app-owned controls", () => {
		const product = mount(productEntryDemo);
		const rating = control(product, "Quality Rating") as HTMLInputElement;
		expect([rating.type, rating.min, rating.max, rating.step]).toEqual(["number", "1", "5", "1"]);
		expect(
			[...(control(product, "Category") as HTMLSelectElement).options].map((option) => option.textContent),
		).toContain("Electronics");

		const vessel = mount(customLayoutDemo);
		expect([...vessel.container.querySelectorAll("h2")].map((heading) => heading.textContent)).toEqual([
			"Vessel Identity",
			"Classification",
			"Dimensions & Capacity",
		]);
		expect((control(vessel, "Year Built") as HTMLInputElement).step).toBe("1");
	});
});

describe("lifecycle and accessibility", () => {
	it("submits valid data and resets edited data through FormApi", async () => {
		const view = mount(userProfileDemo);
		const age = control(view, "Age") as HTMLInputElement;
		input(age, "42");
		await click(view, "Submit");
		expect(view.container.querySelector("[data-formbar-status]")?.textContent).toBe("Form submitted.");
		await click(view, "Reset");
		expect(age.value).toBe("");
		expect(view.container.querySelector("[data-formbar-status]")?.textContent).toBe("");

		const kitchen = mount(kitchenSinkDemo);
		const withDefault = control(kitchen, "With Default Value") as HTMLInputElement;
		expect(withDefault.value).toBe("Hello, ARB!");
		input(withDefault, "Changed");
		await click(kitchen, "Reset");
		expect(withDefault.value).toBe("Hello, ARB!");
		expect(kitchen.container.querySelector('input[type="radio"]:checked')?.parentElement?.textContent).toBe("legacy");
	});

	it("exposes required, description, live-status, and label wiring without inventing schema validation", () => {
		const view = mount(kitchenSinkDemo);
		const required = control(view, "Required Field") as HTMLInputElement;
		expect(required.required).toBe(true);
		expect(required.getAttribute("aria-required")).toBe("true");
		const descriptionId = required.getAttribute("aria-describedby");
		expect(descriptionId).toBeTruthy();
		expect(document.getElementById(descriptionId ?? "")?.textContent).toContain("Required");
		expect(required.getAttribute("aria-invalid")).toBeNull();
		expect(view.container.querySelector('[aria-live="polite"]')).not.toBeNull();
		for (const type of ["text", "number", "checkbox", "radio", "email", "url"]) {
			expect(view.container.querySelector(`input[type="${type}"]`), type).not.toBeNull();
		}
		expect(view.container.querySelector("textarea")).not.toBeNull();
		expect(view.container.querySelector("form select")).not.toBeNull();
	});

	it("labels the historical sliderField key as a constrained native number", () => {
		const view = mount(kitchenSinkDemo);
		const range = control(view, "Value from 0 to 100") as HTMLInputElement;
		expect([range.type, range.min, range.max, range.step]).toEqual(["number", "0", "100", "1"]);
		expect([...view.container.querySelectorAll("label")].some((label) => label.textContent === "Slider")).toBe(false);
	});
});

describe("source and responsive presentation", () => {
	it("remounts the same host path when the JSON Schema detail level changes", () => {
		const view = mount(multiSchemaSourcesDemo);
		const name = view.container.querySelector('form input[type="text"]') as HTMLInputElement;
		input(name, "Unsaved value");
		const chooser = view.container.querySelector("header select") as HTMLSelectElement;
		change(chooser, "explicit");
		const explicitName = control(view, "Full Name") as HTMLInputElement;
		expect(explicitName.value).toBe("");
		expect(view.container.textContent).toContain("Explicit JSON Schema");
		expect(view.container.textContent).toContain("two JSON Schema detail levels");
	});

	it("emits observable base and md span data and CSS variables", () => {
		const view = mount(responsiveSectionsDemo);
		const node = view.container.querySelector('[data-formbar-node="f-first"]') as HTMLElement;
		expect(node.getAttribute("data-formbar-span-base")).toBe("12");
		expect(node.getAttribute("data-formbar-span-md")).toBe("6");
		expect(node.style.getPropertyValue("--formbar-span-base")).toBe("12");
		expect(node.style.getPropertyValue("--formbar-span-md")).toBe("6");
	});
});
