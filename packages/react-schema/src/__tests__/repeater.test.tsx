// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { input, mountForm } from "./renderer-test-utils.js";

async function click(button: HTMLButtonElement): Promise<void> {
	await act(async () => {
		button.click();
		await Promise.resolve();
		await Promise.resolve();
	});
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
	const match = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
	if (!(match instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
	return match;
}

describe("form-backed repeater rendering", () => {
	it("renders primitive rows and preserves private row identity through generated actions", async () => {
		const view = mountForm({
			schema: {
				type: "object",
				properties: { tags: { type: "array", title: "Tags", minItems: 1, maxItems: 3, items: { type: "string" } } },
			},
			data: { tags: ["a", "b"] },
		});
		const fieldset = view.container.querySelector("fieldset[data-formbar-node^='repeater-']");
		expect(fieldset?.querySelector("legend")?.textContent).toBe("Tags");
		expect(fieldset?.querySelectorAll("li")).toHaveLength(2);
		const before = [...(fieldset?.querySelectorAll("input") ?? [])];
		const moveUp = [...view.container.querySelectorAll("button")].find(
			(candidate) => candidate.getAttribute("aria-label") === "Move up, item 2",
		) as HTMLButtonElement;
		await click(moveUp);
		expect(view.form.getState().data.tags).toEqual(["b", "a"]);
		const moved = [...(fieldset?.querySelectorAll("input") ?? [])];
		expect(moved[0]).toBe(before[1]);
		expect(document.activeElement).toBe(moveUp);

		await click(button(view.container, "Add item"));
		expect(view.form.getState().data.tags).toEqual(["b", "a", ""]);
		const added = [...(fieldset?.querySelectorAll("input") ?? [])];
		expect(document.activeElement).toBe(added[2]);
		expect(button(view.container, "Add item").disabled).toBe(true);
		expect(fieldset?.querySelector("[data-formbar-repeater-status]")?.textContent).toContain("Item added");
		const removeSecond = [...view.container.querySelectorAll("button")].find(
			(candidate) => candidate.getAttribute("aria-label") === "Remove, item 2",
		) as HTMLButtonElement;
		await click(removeSecond);
		const removed = [...(fieldset?.querySelectorAll("input") ?? [])];
		expect(view.form.getState().data.tags).toEqual(["b", ""]);
		expect(removed).toEqual([moved[0], added[2]]);
		expect(document.activeElement).toBe(added[2]);
		view.unmount();
	});

	it("renders object and nested array scopes and reconciles external values without coercion", async () => {
		const view = mountForm({
			schema: {
				type: "object",
				properties: {
					people: {
						type: "array",
						items: { type: "object", properties: { name: { type: "string" } } },
					},
					matrix: { type: "array", items: { type: "array", items: { type: "number" } } },
				},
			},
			data: { people: [{ name: "Ada" }], matrix: [[1], [2]] },
		});
		const controls = [...view.container.querySelectorAll("input")];
		expect(controls.map((control) => control.value)).toEqual(["Ada", "1", "2"]);
		input(controls[0], "Grace");
		expect(view.form.getState().data.people[0].name).toBe("Grace");

		const nestedAdd = [...view.container.querySelectorAll("button")].find((candidate) => {
			const target = candidate.getAttribute("data-formbar-array-target") ?? "";
			return candidate.textContent === "Add item" && target.includes("matrix") && target.includes("0");
		}) as HTMLButtonElement;
		await click(nestedAdd);
		expect(view.form.getState().data.matrix[0]).toEqual([1, 0]);

		act(() => view.form.setValue("people", "bad" as never));
		expect(view.form.getState().data.people).toBe("bad");
		expect(view.container.textContent).toContain("Array value is unavailable.");
		act(() => view.form.setValue("people", [{ name: "Recovered" }]));
		expect([...view.container.querySelectorAll("input")].some((control) => control.value === "Recovered")).toBe(true);
		view.unmount();
	});

	it("renders and restores focus for root arrays", async () => {
		const view = mountForm({
			schema: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } },
			data: ["root"],
		});
		await click(button(view.container, "Add item"));
		expect(view.form.getState().data).toEqual(["root", ""]);
		const inputs = [...view.container.querySelectorAll("input")];
		expect(document.activeElement).toBe(inputs[1]);
		expect(button(view.container, "Add item").disabled).toBe(true);
		view.unmount();
	});

	it("regenerates rows on reset and submits no renderer identity", async () => {
		const submitted = vi.fn();
		const view = mountForm({
			schema: { type: "object", properties: { tags: { type: "array", items: { type: "string" } } } },
			data: { tags: ["same", "same"] },
			formOptions: { onSubmit: submitted },
		});
		const first = view.container.querySelector("input") as HTMLInputElement;
		act(() => view.form.setValue("tags", ["left", "right"]));
		expect(view.container.querySelector("input")).toBe(first);
		act(() => view.form.setValue("tags", ["different-length"]));
		expect(view.container.querySelector("input")).not.toBe(first);
		const beforeReset = view.container.querySelector("input");
		act(() => view.form.reset());
		const resetFirst = view.container.querySelector("input") as HTMLInputElement;
		expect(resetFirst).not.toBe(beforeReset);
		await act(async () => {
			await view.form.submit();
		});
		expect(submitted).toHaveBeenCalled();
		const payload = submitted.mock.calls[0]?.[0].payload;
		expect(payload).toEqual({ tags: ["same", "same"] });
		expect(JSON.stringify(payload)).not.toMatch(/_id|row:new|generation/);
		view.unmount();
	});

	it("maps nested descriptor wildcards to numeric rows without treating literal stars as wildcards", () => {
		const view = mountForm({
			schema: {
				type: "object",
				properties: {
					rows: {
						type: "array",
						items: {
							type: "object",
							properties: {
								choice: { enum: ["red", "blue"] },
								code: { type: "string", minLength: 2, maxLength: 4, description: "Row code" },
							},
						},
					},
					matrix: { type: "array", items: { type: "array", items: { enum: [1, 2] } } },
					"*": { enum: ["literal-only"] },
				},
			},
			data: { rows: [{ choice: "red", code: "AB" }], matrix: [[1]], "*": "literal-only" },
		});
		const options = [...view.container.querySelectorAll("select")].map((select) =>
			[...select.options].map((option) => option.textContent),
		);
		expect(options).toContainEqual(["", "red", "blue"]);
		expect(options).toContainEqual(["", "1", "2"]);
		expect(options).toContainEqual(["", "literal-only"]);
		const code = view.container.querySelector('input[type="text"]') as HTMLInputElement;
		expect(code.minLength).toBe(2);
		expect(code.maxLength).toBe(4);
		expect(view.container.textContent).toContain("Row code");
		view.unmount();
	});
});
