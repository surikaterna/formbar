// @vitest-environment jsdom
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { filtersAppliedEvent } from "../actions/search-filter-actions";
import { richValidationDemo } from "../demos/06-rich-validation";
import { searchFiltersDemo } from "../demos/11-search-filters";
import { arbiterValidationDemo } from "../demos/20-arbiter-validation-gating";
import type { SchemaDemoFixture } from "../demos/baseline-contracts";
import {
	button,
	cleanupDemos,
	click,
	labelled,
	mountDemo,
	resultJson,
	setInput,
	setSelect,
} from "./extension-demo-test-utils";

afterEach(cleanupDemos);

async function nativeSubmit(view: Awaited<ReturnType<typeof mountDemo>>) {
	await act(async () => {
		view.container.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
		await Promise.resolve();
	});
}

function input(view: Awaited<ReturnType<typeof mountDemo>>, label: string, value: string) {
	setInput(labelled(view, label) as HTMLInputElement, value);
}

describe("rich validation runtime", () => {
	it("executes validate, rejects invalid action/direct submits, preserves results, and resets", async () => {
		const submitted = vi.fn();
		const view = await mountDemo(richValidationDemo, submitted, true);
		const age = labelled(view, "Age") as HTMLInputElement;
		const score = labelled(view, "Satisfaction Score") as HTMLInputElement;
		expect([age.type, age.min, age.max, age.step]).toEqual(["range", "13", "150", "1"]);
		expect([score.type, score.min, score.max, score.step]).toEqual(["range", "0", "10", "1"]);
		expect(age.parentElement?.querySelector("output")?.textContent).toBe("Age: 13");
		expect(score.parentElement?.querySelector("output")?.textContent).toBe("Satisfaction Score: 0");
		input(view, "Username", "x!");
		input(view, "Email Address", "invalid");
		input(view, "Password", "short");
		input(view, "Age", "12");
		input(view, "Website", "not a uri");
		input(view, "Satisfaction Score", "11");
		await click(button(view, "Validate"));
		expect(view.container.querySelector('[data-formbar-action="validate"] output')?.textContent).toBe(
			"Action completed.",
		);
		await click(button(view, "Submit"));
		expect(submitted).not.toHaveBeenCalled();
		expect(view.container.querySelector("[data-formbar-error-summary]")?.textContent).toContain("Must match");
		input(view, "Username", "valid_user");
		input(view, "Email Address", "person@example.com");
		input(view, "Password", "password1");
		input(view, "Age", "30");
		input(view, "Website", "https://example.com");
		input(view, "Satisfaction Score", "8");
		expect(age.parentElement?.querySelector("output")?.textContent).toBe("Age: 30");
		expect(score.parentElement?.querySelector("output")?.textContent).toBe("Satisfaction Score: 8");
		await nativeSubmit(view);
		expect(submitted).toHaveBeenCalledOnce();
		const successful = resultJson(view);
		expect(JSON.parse(successful ?? "")).toMatchObject({ username: "valid_user", age: 30, score: 8 });
		input(view, "Email Address", "bad");
		await nativeSubmit(view);
		expect(submitted).toHaveBeenCalledOnce();
		expect(resultJson(view)).toBe(successful);
		await click(button(view, "Reset"));
		expect((labelled(view, "Username") as HTMLInputElement).value).toBe("");
		expect(resultJson(view)).toBe(successful);
	});
});

describe("trusted search action", () => {
	it("emits one immutable current snapshot, completes, and resets without submitting", async () => {
		const submitted = vi.fn();
		const snapshots: unknown[] = [];
		const listener = (event: Event) => snapshots.push((event as CustomEvent).detail);
		window.addEventListener(filtersAppliedEvent, listener);
		const view = await mountDemo(searchFiltersDemo, submitted, true);
		input(view, "Search", "release notes");
		setSelect(labelled(view, "Category") as HTMLSelectElement, "option-1");
		await click(button(view, "Apply Filters"));
		expect(snapshots).toEqual([{ query: "release notes", category: "Documents" }]);
		expect(Object.isFrozen(snapshots[0])).toBe(true);
		expect(view.container.querySelector('output[data-formbar-action="demo11.apply-filters"]')?.textContent).toBe(
			"Action completed.",
		);
		expect(submitted).not.toHaveBeenCalled();
		await click(button(view, "Reset"));
		expect((labelled(view, "Search") as HTMLInputElement).value).toBe("");
		window.removeEventListener(filtersAppliedEvent, listener);
	});

	it("fails an unknown handler probe closed without emitting an event", async () => {
		const source = searchFiltersDemo.sources[0];
		const unknownFixture: SchemaDemoFixture = {
			...searchFiltersDemo,
			id: "search-filters-unknown-probe",
			sources: [
				{
					...source,
					definition: {
						version: 1,
						id: "search-filters-unknown-probe",
						root: { type: "action", id: "unknown", action: "demo11.unknown", label: "Unknown" },
					},
				},
			],
		};
		const listener = vi.fn();
		window.addEventListener(filtersAppliedEvent, listener);
		const view = await mountDemo(unknownFixture);
		const unknown = button(view, "Unknown");
		expect(unknown.disabled).toBe(true);
		expect(view.container.querySelector('[data-formbar-diagnostic="unknown-action"]')).not.toBeNull();
		await click(unknown);
		expect(listener).not.toHaveBeenCalled();
		window.removeEventListener(filtersAppliedEvent, listener);
	});
});

describe("Arbiter validation gate", () => {
	it("gates presentation by terms while schema authority rejects and accepts exact payloads", async () => {
		const submitted = vi.fn();
		const view = await mountDemo(arbiterValidationDemo, submitted, true);
		const submit = button(view, "Submit");
		expect(submit.disabled).toBe(true);
		await click(labelled(view, "I agree to the Terms of Service"));
		expect(submit.disabled).toBe(false);
		await click(submit);
		expect(submitted).not.toHaveBeenCalled();
		expect(view.container.querySelector("[data-formbar-error-summary]")).not.toBeNull();
		input(view, "Full Name", "Ada Lovelace");
		input(view, "Email", "ada@example.com");
		input(view, "Age", "36");
		await nativeSubmit(view);
		expect(submitted).toHaveBeenCalledOnce();
		const successful = resultJson(view);
		expect(JSON.parse(successful ?? "")).toEqual({
			name: "Ada Lovelace",
			email: "ada@example.com",
			age: 36,
			agreeToTerms: true,
		});
		input(view, "Email", "invalid");
		await nativeSubmit(view);
		expect(submitted).toHaveBeenCalledOnce();
		expect(resultJson(view)).toBe(successful);
		await click(button(view, "Reset"));
		expect(button(view, "Submit").disabled).toBe(true);
	});
});
