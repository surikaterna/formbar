// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { customRenderersDemo } from "../demos/16-custom-renderers";
import { RatingWidget } from "../extensions/custom-widget-profile";
import { cleanupDemos, click, mountDemo, resultJson, selector, setSelect, submit } from "./extension-demo-test-utils";

afterEach(cleanupDemos);

describe("trusted installed demo 16 widgets", () => {
	it("renders authored widget IDs through the app-installed profile, not definition-supplied functions", async () => {
		const view = await mountDemo(customRenderersDemo);
		expect(view.container.querySelector("form[data-kalada-v1]"), view.container.textContent ?? "").not.toBeNull();
		expect(view.container.querySelectorAll('[data-widget="demo16.rating"]')).toHaveLength(2);
		expect(view.container.querySelectorAll('[data-widget="demo16.color"]')).toHaveLength(2);
		expect(view.container.querySelector('[data-widget="demo16.checkbox-group"]')).not.toBeNull();
	});

	it("submits schema-valid typed colors and tags through trusted installed widgets", async () => {
		const onSubmit = vi.fn();
		const view = await mountDemo(customRenderersDemo, onSubmit);
		await submit(view);
		expect(onSubmit).not.toHaveBeenCalled();
		const brand = view.container.querySelector<HTMLButtonElement>('button[aria-label="Brand Color: #3B82F6"]');
		const accent = view.container.querySelector<HTMLButtonElement>('button[aria-label="Accent Color: #334155"]');
		if (!brand || !accent) throw new Error("Missing installed color widgets");
		await click(brand);
		await click(accent);
		const performance = [...view.container.querySelectorAll("label")].find(
			(item) => item.textContent === "Performance",
		)?.control;
		if (!(performance instanceof HTMLInputElement)) throw new Error("Missing installed Performance choice");
		await click(performance);
		await submit(view);
		expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ brandColor: "#3B82F6", accentColor: "#334155" }));
		expect(resultJson(view)).toContain('"brandColor": "#3B82F6"');
	});

	it("does not turn unknown extension IDs in a document into trusted renderers", async () => {
		const view = await mountDemo(customRenderersDemo);
		setSelect(selector(view, "JSON Schema source"), "extension-diagnostics");
		expect(view.container.querySelector('[role="alert"]')?.textContent).toMatch(
			/MISSING_TRUSTED_RENDERER|MISSING_RENDERER/,
		);
		expect(view.container.querySelector('[data-widget="demo16.missing-widget"]')).toBeNull();
		expect(view.container.querySelector("form input, form textarea")).toBeNull();
	});

	it("keeps the rating widget inert in read-only and disabled modes", () => {
		const container = document.createElement("div");
		const root = createRoot(container);
		const onChange = vi.fn();
		const onBlur = vi.fn();
		const props: Parameters<typeof RatingWidget>[0] = {
			nodeId: "rating",
			instanceKey: "rating",
			widget: "demo16.rating",
			binding: { namespace: "data", segments: ["rating"], path: "rating" },
			value: 2,
			props: { icon: "star" },
			constraints: { primitive: "integer", minimum: 0, maximum: 5, multipleOf: 1 },
			options: [],
			metadata: { label: "Rating", description: "Choose a rating" },
			policy: { visible: true, disabled: false, readOnly: true, required: true },
			issues: [],
			valid: true,
			validating: false,
			touched: false,
			dirty: false,
			a11y: {
				controlId: "rating",
				labelId: "rating-label",
				descriptionId: "rating-description",
				describedBy: "rating-description",
				invalid: false,
				required: true,
				busy: false,
			},
			onChange,
			onBlur,
		};
		try {
			act(() => root.render(<RatingWidget {...props} />));
			const first = container.querySelector("button");
			if (!first) throw new Error("Missing rating button");
			expect(first.getAttribute("aria-disabled")).toBe("true");
			act(() => first.click());
			expect(onChange).not.toHaveBeenCalled();
			act(() => root.render(<RatingWidget {...props} policy={{ ...props.policy, disabled: true, readOnly: false }} />));
			expect((container.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
		} finally {
			act(() => root.unmount());
		}
	});
});
