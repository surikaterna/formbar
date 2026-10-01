// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { customLayoutTypesDemo } from "../demos/17-custom-layout";
import {
	button,
	cleanupDemos,
	click,
	labelled,
	mountDemo,
	resultJson,
	selector,
	setInput,
	setSelect,
	submit,
} from "./extension-demo-test-utils";

afterEach(cleanupDemos);

describe("trusted installed vessel layout", () => {
	it("renders authored panel and grids with editable schema-attested fields", async () => {
		const view = await mountDemo(customLayoutTypesDemo);
		expect(view.container.querySelector("form[data-kalada-v1]"), view.container.textContent ?? "").not.toBeNull();
		expect(view.container.querySelector('[data-extension-node="inspection-panel"]')).not.toBeNull();
		expect(view.container.querySelectorAll('[data-extension-node="field-grid"]')).toHaveLength(5);
		expect(view.container.querySelectorAll("form input, form select, form textarea")).toHaveLength(14);
	});

	it("validates and submits edited inspection data across section and tab modes", async () => {
		const onSubmit = vi.fn();
		const view = await mountDemo(customLayoutTypesDemo, onSubmit);
		setInput(labelled(view, "Vessel Name") as HTMLInputElement, "Arctic Star");
		await submit(view);
		expect(onSubmit).not.toHaveBeenCalled();
		expect(view.container.querySelector("[data-kalada-issue-summary]")?.textContent).toContain("inspectorName");
		setInput(labelled(view, "Inspector Name") as HTMLInputElement, "Ada Inspector");
		await submit(view);
		expect(onSubmit).toHaveBeenCalledWith(
			expect.objectContaining({ vesselName: "Arctic Star", inspectorName: "Ada Inspector" }),
		);
		setSelect(selector(view, "Definition mode"), "tabs");
		expect(view.container.querySelectorAll('[role="tab"]')).toHaveLength(5);
		await click(button(view, "Reset"));
		expect((labelled(view, "Vessel Name") as HTMLInputElement).value).toBe("");
		expect(resultJson(view)).toBeTruthy();
	});
});
