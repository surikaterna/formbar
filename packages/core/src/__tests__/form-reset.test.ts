import { describe, expect, it } from "vitest";
import { createForm } from "../create-form.js";

describe("form.reset()", () => {
	it("restores data to initial values", () => {
		const form = createForm({ initialData: { name: "Alice" } });
		form.setValue("name", "Bob");
		expect((form.getState().data as Record<string, unknown>).name).toBe("Bob");

		form.reset();
		expect((form.getState().data as Record<string, unknown>).name).toBe("Alice");
		form.dispose();
	});

	it("clears all validation issues", () => {
		const form = createForm({
			initialData: { name: "" },
			validators: [
				() => [
					{
						code: "required",
						message: "Required",
						severity: "error" as const,
						path: { namespace: "data" as const, segments: ["name"], canonical: "name" },
						source: { origin: "function-validator" as const, validatorId: "v1" },
					},
				],
			],
		});
		form.setValue("name", "x");
		expect(form.getState().issues.length).toBeGreaterThan(0);

		form.reset();
		expect(form.getState().issues).toEqual([]);
		form.dispose();
	});

	it("clears fieldMeta (touched/dirty flags reset)", () => {
		const form = createForm({ initialData: { name: "Alice" } });
		form.setValue("name", "Bob");
		expect(Object.keys(form.getState().fieldMeta).length).toBeGreaterThan(0);

		form.reset();
		expect(form.getState().fieldMeta).toEqual({});
		form.dispose();
	});

	it("clears submitted flag", async () => {
		const form = createForm({ initialData: { name: "Alice" } });
		await form.submit();
		expect(form.getState().meta.submitted).toBe(true);

		form.reset();
		expect(form.getState().meta.submitted).toBeUndefined();
		form.dispose();
	});

	it("notifies subscribers", () => {
		const form = createForm({ initialData: { name: "Alice" } });
		form.setValue("name", "Bob");

		const notifications: unknown[] = [];
		form.subscribe((state) => notifications.push(state));

		form.reset();
		expect(notifications).toHaveLength(1);
		form.dispose();
	});

	it("observes every reset and contains listener failures", () => {
		const form = createForm({ initialData: { name: "Alice" } });
		const resets: string[] = [];
		form.onReset(() => {
			throw new Error("private reset failure");
		});
		const unsubscribe = form.onReset(() => resets.push("reset"));
		form.setValue("name", "Bob");
		expect(() => form.reset()).not.toThrow();
		expect(form.getState().data).toEqual({ name: "Alice" });
		expect(resets).toEqual(["reset"]);
		unsubscribe();
		form.reset();
		expect(resets).toEqual(["reset"]);
		form.dispose();
	});

	it("reset({data: newData}) resets to new initial values", () => {
		const form = createForm({ initialData: { name: "Alice" } });
		form.setValue("name", "Bob");

		form.reset({ data: { name: "Charlie" } });
		expect((form.getState().data as Record<string, unknown>).name).toBe("Charlie");
		form.dispose();
	});

	it("after reset({data: newData}), isDirty() uses new baseline", () => {
		const form = createForm({ initialData: { name: "Alice" } });
		form.reset({ data: { name: "Charlie" } });

		const field = form.field("name");
		expect(field.isDirty()).toBe(false);

		form.setValue("name", "Dave");
		expect(field.isDirty()).toBe(true);

		form.setValue("name", "Charlie");
		expect(field.isDirty()).toBe(false);
		form.dispose();
	});

	it("uses the UI baseline for UI field dirty checks and replaces it on reset", () => {
		const form = createForm({ initialData: {}, initialUiState: { panel: { open: false } } });
		const field = form.fieldDynamic("$ui.panel.open");
		expect(field.isDirty()).toBe(false);
		field.set(true);
		expect(field.isDirty()).toBe(true);
		field.set(false);
		expect(field.isDirty()).toBe(false);

		form.reset({ uiState: { panel: { open: true } } });
		const resetField = form.fieldDynamic("$ui.panel.open");
		expect(resetField.isDirty()).toBe(false);
		resetField.set(false);
		expect(resetField.isDirty()).toBe(true);
	});

	it("after reset(), field.isTouched() returns false", () => {
		const form = createForm({ initialData: { name: "Alice" } });
		const field = form.field("name");
		field.markTouched();
		expect(field.isTouched()).toBe(true);

		form.reset();
		// Field cache cleared, get fresh field
		const field2 = form.field("name");
		expect(field2.isTouched()).toBe(false);
		form.dispose();
	});

	it("after reset(), field.isDirty() returns false", () => {
		const form = createForm({ initialData: { name: "Alice" } });
		form.setValue("name", "Bob");
		const field = form.field("name");
		expect(field.isDirty()).toBe(true);

		form.reset();
		const field2 = form.field("name");
		expect(field2.isDirty()).toBe(false);
		form.dispose();
	});
});
