// @vitest-environment jsdom
import type { WidgetProps } from "@formbar/react-schema";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { customRenderersDemo } from "../demos/16-custom-renderers";
import { RatingWidget } from "../extensions/custom-widget-profile";
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

afterEach(() => {
	cleanupDemos();
	vi.restoreAllMocks();
});

function rangeValue(input: HTMLInputElement, value: string): void {
	setInput(input, value);
}

async function chooseValidColorsAndTags(view: Awaited<ReturnType<typeof mountDemo>>): Promise<void> {
	await click(button(view, "Brand Color: #3B82F6"));
	await click(button(view, "Accent Color: #334155"));
	await click(labelled(view, "Performance"));
	await click(labelled(view, "Design"));
}

describe("demo 16 trusted custom widgets", () => {
	it("binds every generated widget with schema options, bounds, typed arrays, touch, and a11y", async () => {
		const onSubmit = vi.fn();
		const view = await mountDemo(customRenderersDemo, onSubmit);
		expect(view.container.querySelectorAll('[data-widget="demo16.rating"]')).toHaveLength(2);
		expect(view.container.querySelectorAll('[data-widget="demo16.color"]')).toHaveLength(2);
		expect(view.container.querySelectorAll('[data-widget="demo16.checkbox-group"]')).toHaveLength(1);
		expect(view.container.querySelectorAll('[data-widget="demo16.progress"]')).toHaveLength(1);
		expect(view.container.querySelectorAll('[data-widget="demo16.range"]')).toHaveLength(0);
		expect(view.container.querySelectorAll('button[aria-label^="Brand Color:"]')).toHaveLength(8);
		expect(view.container.querySelectorAll('button[aria-label^="Accent Color:"]')).toHaveLength(8);
		expect(view.container.querySelectorAll('[data-widget="demo16.checkbox-group"] input')).toHaveLength(5);

		const quality = button(view, "Quality Rating: 3");
		const satisfaction = button(view, "User Satisfaction: 5");
		const qualityNode = quality.closest("[data-formbar-node]");
		const satisfactionNode = satisfaction.closest("[data-formbar-node]");
		expect(quality.getAttribute("aria-labelledby")).toBeTruthy();
		expect(quality.getAttribute("aria-describedby")).toBeTruthy();
		await click(quality);
		act(() => {
			quality.focus();
			quality.blur();
		});
		expect(qualityNode?.getAttribute("data-formbar-touched")).toBe("true");
		expect(satisfactionNode?.hasAttribute("data-formbar-touched")).toBe(false);
		await click(satisfaction);

		await chooseValidColorsAndTags(view);
		await click(labelled(view, "Performance"));
		await click(labelled(view, "Performance"));
		const completion = labelled(view, "Completion Rate") as HTMLInputElement;
		expect([completion.type, completion.min, completion.max, completion.step]).toEqual(["range", "0", "100", "1"]);
		rangeValue(completion, "47");
		expect(view.container.querySelector("progress")?.getAttribute("value")).toBe("47");
		await submit(view);

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
			qualityRating: 3,
			userSatisfaction: 5,
			brandColor: "#3B82F6",
			accentColor: "#334155",
			tags: ["Design", "Performance"],
			completionRate: 47,
		});
		expect(Array.isArray(onSubmit.mock.calls[0]?.[0].tags)).toBe(true);
		expect(resultJson(view)).toContain('"tags": [');
	});

	it("suppresses invalid submission and preserves the last success through reset and another failure", async () => {
		const onSubmit = vi.fn();
		const view = await mountDemo(customRenderersDemo, onSubmit);
		await submit(view);
		expect(onSubmit).not.toHaveBeenCalled();
		expect(view.container.querySelector("[data-formbar-error-summary]")?.textContent).toContain(
			"Must be one of the allowed values.",
		);
		expect(view.container.querySelector("[data-formbar-error-summary]")?.textContent).toContain(
			'JSON Schema keyword "pattern"',
		);
		expect(button(view, "Brand Color: #3B82F6").getAttribute("aria-invalid")).toBe("true");

		await chooseValidColorsAndTags(view);
		await submit(view);
		const successful = resultJson(view);
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(successful).toContain('"brandColor": "#3B82F6"');
		await click(button(view, "Reset"));
		expect(resultJson(view)).toBe(successful);
		await submit(view);
		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(resultJson(view)).toBe(successful);
	});

	it("shows per-option pressed styling and shape markers through selection, reset, and source change", async () => {
		const view = await mountDemo(customRenderersDemo);
		const rating = (value: number) => button(view, `Quality Rating: ${value}`);
		const color = (value: string) => button(view, `Brand Color: ${value}`);
		expect(rating(2).textContent).toContain("☆");
		expect(color("#3B82F6").querySelector('[aria-hidden="true"]')).toBeNull();
		await click(rating(3));
		await click(color("#3B82F6"));
		expect(rating(2).getAttribute("aria-pressed")).toBe("true");
		expect(rating(3).className).toContain("bg-foreground");
		expect(rating(3).textContent).toContain("★");
		expect(rating(4).className).not.toContain("bg-foreground");
		expect(rating(4).textContent).toContain("☆");
		expect(color("#3B82F6").className).toContain("ring-foreground");
		expect(color("#3B82F6").querySelector('[aria-hidden="true"]')?.textContent).toBe("✓");
		await click(rating(1));
		await click(color("#EF4444"));
		expect(rating(2).getAttribute("aria-pressed")).toBe("false");
		expect(rating(2).textContent).toContain("☆");
		expect(color("#3B82F6").querySelector('[aria-hidden="true"]')).toBeNull();
		expect(color("#EF4444").querySelector('[aria-hidden="true"]')?.textContent).toBe("✓");
		await click(button(view, "Reset"));
		expect(rating(1).className).not.toContain("bg-foreground");
		expect(color("#EF4444").querySelector('[aria-hidden="true"]')).toBeNull();
		setSelect(selector(view, "JSON Schema source"), "authored-overrides");
		await act(async () => {
			await Promise.resolve();
		});
		await click(rating(2));
		expect(rating(2).textContent).toContain("♥");
		expect(rating(3).textContent).toContain("♡");
	});

	it("uses authored IDs over conflicting hints, keeps constraints, and remounts source history", async () => {
		const view = await mountDemo(customRenderersDemo);
		await chooseValidColorsAndTags(view);
		await submit(view);
		expect(resultJson(view)).toBeTruthy();
		setSelect(selector(view, "JSON Schema source"), "authored-overrides");
		expect(resultJson(view)).toBeUndefined();
		const qualityNode = view.container.querySelector('[data-formbar-node="f-quality-rating"]');
		expect(qualityNode?.querySelector('[data-widget="demo16.rating"]')).not.toBeNull();
		expect(qualityNode?.querySelector('[data-widget="demo16.color"]')).toBeNull();
		expect(qualityNode?.textContent).toContain("♡");
		const completion = labelled(view, "Completion Rate") as HTMLInputElement;
		expect([completion.type, completion.min, completion.max, completion.step]).toEqual(["range", "0", "100", "1"]);
		expect(view.container.querySelector('[data-widget="demo16.range"]')).not.toBeNull();
		expect(view.container.querySelector("progress")).toBeNull();
		expect(view.container.querySelector("[data-formbar-diagnostic]")).toBeNull();
	});

	it("isolates both missing-ID fallbacks in the opt-in diagnostic source", async () => {
		const view = await mountDemo(customRenderersDemo);
		setSelect(selector(view, "JSON Schema source"), "extension-diagnostics");
		const diagnostics = [...view.container.querySelectorAll('[data-formbar-diagnostic="missing-extension"]')];
		expect(diagnostics).toHaveLength(2);
		expect(diagnostics.map((item) => item.textContent)).toEqual([
			"This form item cannot be rendered.",
			"This form item cannot be rendered.",
		]);
		expect(view.container.querySelector("form")).not.toBeNull();
	});

	it("honors required, busy, issue, disabled, and read-only state without bypassing callbacks", async () => {
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		const onChange = vi.fn();
		const onBlur = vi.fn();
		const props: WidgetProps = {
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
			issues: [
				{
					code: "invalid",
					message: "Invalid",
					severity: "error",
					path: { namespace: "data", segments: ["rating"] },
					source: { origin: "function-validator", validatorId: "demo-test" },
				},
			],
			valid: false,
			validating: true,
			touched: true,
			dirty: true,
			a11y: {
				controlId: "rating",
				labelId: "rating-label",
				descriptionId: "rating-description",
				errorId: "rating-error",
				describedBy: "rating-description rating-error",
				invalid: true,
				required: true,
				busy: true,
			},
			onChange,
			onBlur,
		};
		act(() => root.render(<RatingWidget {...props} />));
		const first = container.querySelector("button") as HTMLButtonElement;
		expect(first).toMatchObject({ id: "rating", disabled: false });
		expect(first.getAttribute("aria-required")).toBe("true");
		expect(first.getAttribute("aria-busy")).toBe("true");
		expect(first.getAttribute("aria-invalid")).toBe("true");
		expect(first.getAttribute("aria-disabled")).toBe("true");
		expect(container.querySelector("[data-issue-count]")?.getAttribute("data-issue-count")).toBe("1");
		await click(first);
		expect(onChange).not.toHaveBeenCalled();
		act(() => first.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
		expect(onBlur).toHaveBeenCalledTimes(1);
		act(() => root.render(<RatingWidget {...props} policy={{ ...props.policy, disabled: true, readOnly: false }} />));
		expect((container.querySelector("button") as HTMLButtonElement).disabled).toBe(true);
		act(() => root.unmount());
		container.remove();
	});

	it("keeps the stable profile clean under StrictMode", async () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const view = await mountDemo(customRenderersDemo, undefined, true);
		await click(button(view, "Quality Rating: 1"));
		setSelect(selector(view, "JSON Schema source"), "authored-overrides");
		setSelect(selector(view, "JSON Schema source"), "schema-hints");
		expect(view.container.querySelector("[data-formbar-diagnostic]")).toBeNull();
		expect(error).not.toHaveBeenCalled();
	});
});
