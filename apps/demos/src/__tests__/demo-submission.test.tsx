// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { basicContactDemo } from "../demos/01-basic-contact";
import { conditionalFieldsDemo } from "../demos/07-conditional-fields";
import { multiSchemaSourcesDemo } from "../demos/13-multi-schema-sources";
import type { SchemaDemoFixture } from "../demos/baseline-contracts";
import { button, cleanupDemos, click, labelled, mountDemo, resultJson, setInput } from "./extension-demo-test-utils";
import { formSubmit, required } from "./kalada-demo-c-test-utils";

afterEach(cleanupDemos);

describe("app-installed Kalada submission boundary", () => {
	it("captures one frozen, schema-validated snapshot without native DOM validation", async () => {
		const submitted = vi.fn();
		const check = vi.spyOn(HTMLFormElement.prototype, "checkValidity");
		const report = vi.spyOn(HTMLFormElement.prototype, "reportValidity");
		try {
			const view = await mountDemo(basicContactDemo, submitted, true);
			const form = view.container.querySelector("form[data-kalada-v1]");
			expect(form?.hasAttribute("novalidate")).toBe(true);
			await click(formSubmit(view));
			expect(submitted).not.toHaveBeenCalled();
			expect(view.container.querySelector("[data-kalada-issue-summary]")).not.toBeNull();
			setInput(labelled(view, "Full Name") as HTMLInputElement, "Ada");
			setInput(labelled(view, "Email") as HTMLInputElement, "ada@example.com");
			await click(formSubmit(view));
			expect(submitted).toHaveBeenCalledOnce();
			expect(submitted.mock.calls[0]?.[0]).toEqual({ name: "Ada", email: "ada@example.com" });
			expect(Object.isFrozen(submitted.mock.calls[0]?.[0])).toBe(true);
			expect(check).not.toHaveBeenCalled();
			expect(report).not.toHaveBeenCalled();
			const success = resultJson(view);
			setInput(labelled(view, "Email") as HTMLInputElement, "invalid");
			await click(formSubmit(view));
			expect(submitted).toHaveBeenCalledOnce();
			expect(resultJson(view)).toBe(success);
			await click(button(view, "Reset"));
			expect(resultJson(view)).toBe(success);
		} finally {
			check.mockRestore();
			report.mockRestore();
		}
	});

	it("remounts selected sources with independent result history and validation", async () => {
		const submitted = vi.fn();
		const view = await mountDemo(multiSchemaSourcesDemo, submitted, true);
		expect(view.container.querySelector("form[data-kalada-v1]"), view.container.textContent).not.toBeNull();
		await click(formSubmit(view));
		expect(submitted).toHaveBeenCalledOnce();
		const source = required(view.container.querySelector<HTMLSelectElement>("header select"), "source selector");
		act(() => {
			source.value = "explicit";
			source.dispatchEvent(new Event("change", { bubbles: true }));
		});
		expect(resultJson(view)).toBeUndefined();
		await click(formSubmit(view));
		expect(submitted).toHaveBeenCalledOnce();
		expect(view.container.querySelector("[data-kalada-issue-summary]")).not.toBeNull();
	});

	it("omits inactive conditional values from the outgoing snapshot, not just the rendered DOM", async () => {
		const submitted = vi.fn();
		const source = conditionalFieldsDemo.sources[0];
		const fixture: SchemaDemoFixture = {
			...conditionalFieldsDemo,
			sources: [
				{
					...source,
					definition: { ...source.definition, submission: { hiddenValues: "omit-inactive" } },
					initialData: { employmentStatus: "Employed", companyName: "Visible", schoolName: "Private" },
				},
			],
		};
		const view = await mountDemo(fixture, submitted);
		expect(view.container.querySelector("form[data-kalada-v1]"), view.container.textContent).not.toBeNull();
		await click(formSubmit(view));
		expect(submitted).toHaveBeenCalledOnce();
		expect(submitted.mock.calls[0]?.[0]).toMatchObject({ employmentStatus: "Employed", companyName: "Visible" });
		expect(submitted.mock.calls[0]?.[0]).not.toHaveProperty("schoolName");
	});
});
