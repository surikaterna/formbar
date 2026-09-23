// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import { mountForm } from "./renderer-test-utils.js";

describe("repeater accessibility", () => {
	it("uses labeled list and item groups, unique controls, native buttons, empty state, and min guards", async () => {
		const view = mountForm({
			schema: {
				type: "object",
				properties: { rows: { type: "array", title: "Rows", minItems: 1, items: { type: "string" } } },
			},
			data: { rows: ["one"] },
			strict: true,
		});
		const repeater = view.container.querySelector("fieldset[data-formbar-node^='repeater-']") as HTMLFieldSetElement;
		expect(repeater.getAttribute("aria-labelledby")).toBe(repeater.querySelector("legend")?.id);
		expect(repeater.querySelector("ol")?.getAttribute("aria-label")).toBe("Rows items");
		expect(repeater.querySelector("li fieldset")?.getAttribute("aria-label")).toBe("Item 1");
		const ids = [...view.container.querySelectorAll("[id]")].map((element) => element.id);
		expect(new Set(ids).size).toBe(ids.length);
		const remove = [...view.container.querySelectorAll("button")].find((item) => item.textContent === "Remove");
		expect(remove).toMatchObject({ type: "button", disabled: true });
		expect(remove?.getAttribute("aria-label")).toBe("Remove, item 1");
		expect(repeater.querySelector("[aria-live='polite']")).not.toBeNull();
		view.unmount();

		const empty = mountForm({
			schema: { type: "object", properties: { rows: { type: "array", items: { type: "string" } } } },
			data: { rows: [] as string[] },
		});
		expect(empty.container.querySelector("[data-formbar-empty]")?.textContent).toBe("No items.");
		const add = [...empty.container.querySelectorAll("button")].find(
			(item) => item.textContent === "Add item",
		) as HTMLButtonElement;
		await act(async () => {
			add.focus();
			add.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
			add.click();
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(empty.form.getState().data.rows).toEqual([""]);
		empty.unmount();
	});
});
