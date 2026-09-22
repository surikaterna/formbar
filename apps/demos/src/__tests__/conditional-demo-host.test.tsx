// @vitest-environment jsdom
import { createArbiterPlugin } from "@formbar/arbiter";
import { createForm } from "@formbar/core";
import type { FormDefinition } from "@formbar/declarative";
import { createSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";
import { FormRenderer } from "@formbar/react-schema";
import { StrictMode, act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { conditionalFieldsDemo } from "../demos/07-conditional-fields";
import { surveyDemo } from "../demos/12-survey-questionnaire";
import {
	arbiterVisibilityData,
	arbiterVisibilityDefinition,
	arbiterVisibilityDemo,
	arbiterVisibilityRules,
	arbiterVisibilitySchema,
} from "../demos/18-arbiter-visibility";
import { arbiterDynamicSectionsDemo } from "../demos/21-arbiter-dynamic-sections";
import type { SchemaDemoFixture } from "../demos/baseline-contracts";
import { SchemaDemoHost } from "../renderers/SchemaDemoHost";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface MountedView {
	readonly container: HTMLDivElement;
	readonly root: Root;
	readonly dispose?: () => void;
}

const mounted: MountedView[] = [];
afterEach(async () => {
	for (const view of mounted.splice(0)) {
		act(() => view.root.unmount());
		view.dispose?.();
	}
	await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
	document.body.replaceChildren();
});

function mount(fixture: SchemaDemoFixture, strict = false): MountedView {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const host = <SchemaDemoHost fixture={fixture} />;
	act(() => root.render(strict ? <StrictMode>{host}</StrictMode> : host));
	const view = { container, root };
	mounted.push(view);
	return view;
}

function node(view: MountedView, id: string): HTMLElement | null {
	return view.container.querySelector(`[data-formbar-node="${id}"]`);
}

function optionSnapshot(select: HTMLSelectElement): readonly (readonly [string, string])[] {
	return [...select.options].map((option) => [option.textContent ?? "", option.value] as const);
}

function mountVisibilityProbe() {
	const prepared = createSchemaForm(arbiterVisibilitySchema, {
		provider: jsonSchemaProvider(),
		side: "input",
		definition: arbiterVisibilityDefinition,
	});
	const form = createForm<Record<string, unknown>, Record<string, never>>({
		initialData: arbiterVisibilityData,
		initialUiState: {},
		plugins: [createArbiterPlugin({ rules: arbiterVisibilityRules })],
	});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	act(() => root.render(<FormRenderer {...prepared} form={form} />));
	const view = { container, root, dispose: () => form.dispose() };
	mounted.push(view);
	return { view, form };
}

function labelled(view: MountedView, text: string): HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
	const label = [...view.container.querySelectorAll("label")].find(
		(candidate) => candidate.textContent?.trim() === text,
	);
	const element = label?.htmlFor
		? document.getElementById(label.htmlFor)
		: label?.querySelector("input,select,textarea");
	if (
		!(
			element instanceof HTMLInputElement ||
			element instanceof HTMLTextAreaElement ||
			element instanceof HTMLSelectElement
		)
	) {
		throw new Error(`Missing control labelled ${text}`);
	}
	return element;
}

function input(view: MountedView, label: string, value: string): void {
	const element = labelled(view, label);
	if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement))
		throw new Error(`${label} is not input`);
	act(() => {
		const prototype =
			element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
		Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
		element.dispatchEvent(new Event("input", { bubbles: true }));
	});
}

function select(view: MountedView, label: string, optionText: string): void {
	const element = labelled(view, label);
	if (!(element instanceof HTMLSelectElement)) throw new Error(`${label} is not select`);
	const option = [...element.options].find((candidate) => candidate.textContent === optionText);
	if (!option) throw new Error(`Missing ${optionText} option`);
	act(() => {
		Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(element, option.value);
		element.dispatchEvent(new Event("change", { bubbles: true }));
	});
}

function clickLabel(view: MountedView, text: string): void {
	act(() => labelled(view, text).click());
}

async function clickButton(view: MountedView, text: string): Promise<void> {
	const button = [...view.container.querySelectorAll("button")].find(
		(candidate) => candidate.textContent?.trim() === text,
	);
	if (!button) throw new Error(`Missing ${text} button`);
	await act(async () => {
		button.click();
		await Promise.resolve();
	});
}

async function nativeSubmit(view: MountedView): Promise<void> {
	await act(async () => {
		view.container.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
		await Promise.resolve();
	});
}

describe("native conditional demos", () => {
	it("mounts every demo 7 branch and retains values while a branch is hidden", () => {
		const view = mount(conditionalFieldsDemo);
		const branches = [
			[
				"Employed",
				"employment-details",
				["f-company-name", "f-job-title", "f-annual-income-employed", "f-health-insurance-employed"],
			],
			[
				"Self-Employed",
				"business-details",
				["f-business-name", "f-business-type", "f-annual-income-self-employed", "f-health-insurance-self-employed"],
			],
			["Student", "education-details", ["f-school-name", "f-field-of-study", "f-health-insurance-student"]],
			["Retired", "retired-details", ["f-annual-income-retired", "f-health-insurance-retired"]],
			["Unemployed", "unemployed-details", ["f-health-insurance-unemployed"]],
		] as const;
		for (const [status, section, fieldIds] of branches) {
			clickLabel(view, status);
			expect(node(view, section), status).not.toBeNull();
			expect(
				fieldIds.every((id) => node(view, id) !== null),
				status,
			).toBe(true);
			expect(branches.filter(([, id]) => id !== section).every(([, id]) => node(view, id) === null)).toBe(true);
			if (status === "Employed") input(view, "Company Name", "Retained employer");
		}
		clickLabel(view, "Employed");
		expect((labelled(view, "Company Name") as HTMLInputElement).value).toBe("Retained employer");
	});

	it("exercises all survey controls, projected required state, and both real submit paths", async () => {
		const view = mount(surveyDemo);
		clickLabel(view, "Very Satisfied");
		clickLabel(view, "Definitely");
		input(view, "Net Promoter Score", "9");
		clickLabel(view, "Performance");
		select(view, "Area for Improvement", "Pricing");
		clickLabel(view, "Daily");
		input(view, "Additional Feedback", "Clear survey feedback");
		expect(node(view, "f-email")).toBeNull();
		clickLabel(view, "May We Contact You?");
		const email = labelled(view, "Email") as HTMLInputElement;
		expect([email.required, email.getAttribute("aria-required")]).toEqual([true, "true"]);
		input(view, "Email", "person@example.com");
		input(view, "Email", "");
		await nativeSubmit(view);
		expect(view.container.querySelector("[data-formbar-status]")?.textContent).toBe("Form submitted.");
		await clickButton(view, "Submit");
		expect(view.container.querySelector("[data-formbar-status]")?.textContent).toBe("Form submitted.");
		input(view, "Email", "retained@example.com");
		clickLabel(view, "May We Contact You?");
		expect(node(view, "f-email")).toBeNull();
		clickLabel(view, "May We Contact You?");
		expect((labelled(view, "Email") as HTMLInputElement).value).toBe("retained@example.com");
	});
});

describe("Arbiter-backed host transitions", () => {
	it("renders one typed placeholder and preserves clear/reset data semantics for every regional select", () => {
		const { view, form } = mountVisibilityProbe();
		const country = labelled(view, "Country") as HTMLSelectElement;
		expect(optionSnapshot(country)).toEqual([
			["", ""],
			["US", "option-0"],
			["CA", "option-1"],
			["UK", "option-2"],
			["DE", "option-3"],
		]);
		expect([country.selectedIndex, form.getState().data]).toEqual([0, { region: "" }]);
		select(view, "Country", "US");
		expect(form.getState().data.country).toBe("US");
		const state = labelled(view, "State") as HTMLSelectElement;
		expect(optionSnapshot(state)).toEqual([
			["", ""],
			["California", "option-0"],
			["New York", "option-1"],
			["Texas", "option-2"],
			["Florida", "option-3"],
		]);
		expect(state.selectedIndex).toBe(0);
		select(view, "State", "Texas");
		select(view, "Country", "CA");
		const province = labelled(view, "Province") as HTMLSelectElement;
		expect(optionSnapshot(province)).toEqual([
			["", ""],
			["Ontario", "option-0"],
			["Quebec", "option-1"],
			["British Columbia", "option-2"],
			["Alberta", "option-3"],
		]);
		expect(province.selectedIndex).toBe(0);
		select(view, "Province", "Ontario");
		expect(form.getState().data.province).toBe("Ontario");
		select(view, "Province", "");
		expect(form.getState().data).toMatchObject({ country: "CA", state: "Texas", province: undefined });
		select(view, "Country", "");
		expect(form.getState().data.country).toBeUndefined();
		act(() => form.reset());
		expect(form.getState().data).toEqual({ region: "" });
		expect((labelled(view, "Country") as HTMLSelectElement).selectedIndex).toBe(0);
		expect(node(view, "regional-details")).toBeNull();
	});

	it("handles US/CA/UK/DE/clear without stale visibility and retains hidden regional data", () => {
		const view = mount(arbiterVisibilityDemo);
		expect(node(view, "regional-details")).toBeNull();
		select(view, "Country", "US");
		expect([
			node(view, "f-state") !== null,
			node(view, "f-province") !== null,
			node(view, "f-region") !== null,
		]).toEqual([true, false, false]);
		select(view, "State", "Texas");
		select(view, "Country", "CA");
		expect([node(view, "f-state"), node(view, "f-province") !== null, node(view, "f-region")]).toEqual([
			null,
			true,
			null,
		]);
		select(view, "Province", "Ontario");
		select(view, "Country", "UK");
		expect([node(view, "f-state"), node(view, "f-province"), node(view, "f-region") !== null]).toEqual([
			null,
			null,
			true,
		]);
		input(view, "Region", "Scotland");
		select(view, "Country", "DE");
		expect((labelled(view, "Region") as HTMLInputElement).value).toBe("Scotland");
		select(view, "Country", "US");
		expect((labelled(view, "State") as HTMLSelectElement).selectedOptions[0].textContent).toBe("Texas");
		select(view, "Country", "");
		expect(node(view, "regional-details")).toBeNull();
	});

	it("mounts all nine detail controls, replaces required cues, clears, and retains values", () => {
		const view = mount(arbiterDynamicSectionsDemo, true);
		expect(view.container.querySelectorAll("form section")).toHaveLength(0);
		select(view, "Coverage Type", "auto");
		for (const label of ["Make", "Model", "Year"])
			expect((labelled(view, label) as HTMLInputElement).required).toBe(true);
		input(view, "Make", "Saab");
		input(view, "Model", "900");
		input(view, "Year", "1992");
		select(view, "Coverage Type", "home");
		for (const label of ["Address", "Square Footage", "Year Built"]) {
			expect((labelled(view, label) as HTMLInputElement).required).toBe(true);
			input(view, label, label === "Address" ? "1 Main St" : "2000");
		}
		select(view, "Coverage Type", "life");
		for (const label of ["Age", "Smoker", "Pre-existing Conditions"]) {
			expect((labelled(view, label) as HTMLInputElement).required).toBe(true);
		}
		input(view, "Age", "40");
		clickLabel(view, "Smoker");
		input(view, "Pre-existing Conditions", "None");
		select(view, "Coverage Type", "auto");
		expect((labelled(view, "Make") as HTMLInputElement).value).toBe("Saab");
		select(view, "Coverage Type", "");
		expect(view.container.querySelectorAll("form section")).toHaveLength(0);
	});
});

describe("hidden validation authority", () => {
	it("retains a hidden errored value and blocks submit through an explicit validator", async () => {
		const definition: FormDefinition = {
			version: 1,
			id: "authority-probe",
			root: {
				type: "conditional",
				id: "when-visible",
				condition: { kind: "ref", ref: { namespace: "data", segments: ["show"] } },
				// biome-ignore lint/suspicious/noThenProperty: This is serialized FormDefinition branch data.
				then: [{ type: "field", id: "secret", binding: { namespace: "data", segments: ["secret"] }, widget: "text" }],
			},
		};
		const prepared = createSchemaForm(
			{ type: "object", properties: { show: { type: "boolean" }, secret: { type: "string" } } },
			{ provider: jsonSchemaProvider(), side: "input", definition },
		);
		const form = createForm({
			initialData: { show: true, secret: "retained invalid data" },
			validators: [
				() => [
					{
						code: "hidden-invalid",
						message: "Hidden value is invalid",
						severity: "error",
						path: { namespace: "data", segments: ["secret"] },
						source: { origin: "function-validator", validatorId: "authority" },
					},
				],
			],
			onSubmit: async () => ({ ok: true, submitId: "unexpected" }),
		});
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		act(() => root.render(<FormRenderer {...prepared} form={form} />));
		act(() => form.setValue("show", false));
		expect(container.querySelector('[data-formbar-node="secret"]')).toBeNull();
		await act(async () => expect(form.submit()).resolves.toMatchObject({ ok: false }));
		expect(container.querySelector("[data-formbar-error-summary]")?.textContent).toContain("Hidden value is invalid");
		expect(form.getState().data.secret).toBe("retained invalid data");
		act(() => root.unmount());
		form.dispose();
	});
});
