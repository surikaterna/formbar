// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { customLayoutTypesDemo } from "../demos/17-custom-layout";
import {
	button,
	cleanupDemos,
	click,
	keyDown,
	labelled,
	mountDemo,
	resultJson,
	selector,
	setInput,
	setSelect,
	submit,
} from "./extension-demo-test-utils";

afterEach(() => {
	cleanupDemos();
	vi.restoreAllMocks();
});

function input(view: Awaited<ReturnType<typeof mountDemo>>, label: string, value: string): void {
	setInput(labelled(view, label) as HTMLInputElement | HTMLTextAreaElement, value);
}

function mode(view: Awaited<ReturnType<typeof mountDemo>>, value: string): void {
	setSelect(selector(view, "Definition mode"), value);
}

describe("demo 17 advanced layout profile", () => {
	it("renders exact section chrome, fourteen production fields, constraints, and custom children", async () => {
		const view = await mountDemo(customLayoutTypesDemo);
		expect(view.container.querySelectorAll('[data-extension-node="inspection-panel"]')).toHaveLength(1);
		expect(view.container.querySelectorAll('[data-extension-node="field-grid"]')).toHaveLength(5);
		expect(
			[...view.container.querySelectorAll('[data-extension-node="field-grid"]')].map((grid) =>
				grid.getAttribute("data-columns"),
			),
		).toEqual(["2", "2", "2", "2", "2"]);
		expect(view.container.querySelector('[data-extension-node="field-grid"]')?.getAttribute("style")).toBeNull();
		expect(view.container.querySelectorAll('form [data-formbar-node^="f-"]')).toHaveLength(14);
		expect([...view.container.querySelectorAll("form h2")].map((heading) => heading.textContent)).toEqual([
			"Vessel Inspection",
			"General Information",
			"Hull Inspection",
			"Engine & Fuel",
			"Safety Equipment",
			"Summary",
		]);
		expect(labelled(view, "Hull Notes")).toBeInstanceOf(HTMLTextAreaElement);
		expect(labelled(view, "Comments")).toBeInstanceOf(HTMLTextAreaElement);
		const hours = labelled(view, "Engine Hours") as HTMLInputElement;
		const fuel = labelled(view, "Fuel Level (%)") as HTMLInputElement;
		const score = labelled(view, "Overall Score") as HTMLInputElement;
		expect([hours.min, hours.max, hours.step]).toEqual(["0", "100000", "1"]);
		expect([fuel.min, fuel.max, fuel.step]).toEqual(["0", "100", "1"]);
		expect([score.min, score.max, score.step]).toEqual(["1", "10", "1"]);
		expect((labelled(view, "Vessel Name") as HTMLInputElement).required).toBe(true);
		expect((labelled(view, "Inspector Name") as HTMLInputElement).required).toBe(true);
		expect(view.container.querySelector("[data-formbar-diagnostic]")).toBeNull();
	});

	it("validates submission once and preserves data, issues, and last success across modes", async () => {
		const onSubmit = vi.fn();
		const view = await mountDemo(customLayoutTypesDemo, onSubmit);
		input(view, "Vessel Name", "Arctic Star");
		await submit(view);
		expect(onSubmit).not.toHaveBeenCalled();
		expect(view.container.querySelector("[data-formbar-error-summary]")?.textContent).toContain(
			'Required property "inspectorName" is missing.',
		);
		input(view, "Inspector Name", "Ada Inspector");
		await submit(view);
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ vesselName: "Arctic Star", inspectorName: "Ada Inspector" });
		const successful = resultJson(view);
		mode(view, "tabs");
		expect((labelled(view, "Vessel Name") as HTMLInputElement).value).toBe("Arctic Star");
		expect(resultJson(view)).toBe(successful);
		mode(view, "sections");
		await click(button(view, "Reset"));
		await submit(view);
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(resultJson(view)).toBe(successful);
		mode(view, "tabs");
		expect((labelled(view, "Inspector Name") as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
		expect(resultJson(view)).toBe(successful);
		mode(view, "accordion");
		expect((labelled(view, "Vessel Name") as HTMLInputElement).value).toBe("");
		expect(resultJson(view)).toBe(successful);
	});

	it("uses production tab activation and Left/Right/Home/End keyboard behavior", async () => {
		const view = await mountDemo(customLayoutTypesDemo);
		mode(view, "tabs");
		const tabs = [...view.container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
		expect(tabs.map((tab) => tab.textContent)).toEqual(["General", "Hull", "Engine", "Safety", "Summary"]);
		expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false", "false"]);
		expect(view.container.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
		tabs[0].focus();
		keyDown(tabs[0], "ArrowRight");
		expect(tabs[1].getAttribute("aria-selected")).toBe("true");
		expect(document.activeElement).toBe(tabs[1]);
		keyDown(tabs[1], "End");
		expect(tabs[4].getAttribute("aria-selected")).toBe("true");
		keyDown(tabs[4], "Home");
		expect(tabs[0].getAttribute("aria-selected")).toBe("true");
		keyDown(tabs[0], "ArrowLeft");
		expect(tabs[4].getAttribute("aria-selected")).toBe("true");
		await click(tabs[2]);
		expect(
			view.container.querySelector('[role="tabpanel"]:not([hidden]) [data-formbar-node="f-engineHours"]'),
		).not.toBeNull();
		expect(
			view.container.querySelector('[role="tabpanel"]:not([hidden]) [data-formbar-node="f-vesselName"]'),
		).toBeNull();
	});

	it("supports independently expanded labelled accordion regions and focus navigation", async () => {
		const view = await mountDemo(customLayoutTypesDemo);
		mode(view, "accordion");
		const headers = [...view.container.querySelectorAll<HTMLButtonElement>("[aria-expanded][aria-controls]")];
		expect(headers.map((header) => header.textContent)).toEqual([
			"General Information",
			"Hull Inspection",
			"Engine & Fuel",
			"Safety Equipment",
			"Summary",
		]);
		expect(headers[0].getAttribute("aria-expanded")).toBe("true");
		await click(headers[1]);
		expect(headers[0].getAttribute("aria-expanded")).toBe("true");
		expect(headers[1].getAttribute("aria-expanded")).toBe("true");
		const regions = [...view.container.querySelectorAll<HTMLElement>('[role="region"]')];
		expect(regions[0].getAttribute("aria-labelledby")).toBe(headers[0].id);
		expect(regions[1].getAttribute("aria-labelledby")).toBe(headers[1].id);
		headers[1].focus();
		keyDown(headers[1], "ArrowDown");
		expect(document.activeElement).toBe(headers[2]);
		keyDown(headers[2], "ArrowUp");
		expect(document.activeElement).toBe(headers[1]);
		keyDown(headers[1], "End");
		expect(document.activeElement).toBe(headers[4]);
		keyDown(headers[4], "Home");
		expect(document.activeElement).toBe(headers[0]);
	});

	it("retains clean profile behavior during StrictMode mode changes", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const view = await mountDemo(customLayoutTypesDemo, undefined, true);
		input(view, "Vessel Name", "Strict Vessel");
		mode(view, "tabs");
		mode(view, "accordion");
		mode(view, "sections");
		expect((labelled(view, "Vessel Name") as HTMLInputElement).value).toBe("Strict Vessel");
		expect(view.container.querySelector("[data-formbar-diagnostic]")).toBeNull();
		expect(error).not.toHaveBeenCalled();
	});
});
