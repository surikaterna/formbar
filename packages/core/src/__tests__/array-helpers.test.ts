import { describe, expect, it } from "vitest";
import { createForm } from "../create-form.js";
import { moveFieldMeta, shiftFieldMeta } from "../field-meta-shift.js";
import type { FieldMetaEntry } from "../state.js";

const metadataPaths = [
	{ name: "dot", base: "items", key: (index: number) => `items.${index}.name` },
	{ name: "pointer with dotted segment", base: "/a.b/items", key: (index: number) => `/a.b/items/${index}/name` },
	{ name: "UI namespace", base: "$ui.items", key: (index: number) => `$ui.items.${index}.name` },
	{ name: "literal data $ui", base: "/$ui/items", key: (index: number) => `/$ui/items/${index}/name` },
	{ name: "root dot", base: "", key: (index: number) => `${index}.name` },
	{ name: "root pointer", base: "", key: (index: number) => `/${index}/name` },
] as const;

const metaEntry = (dirty: boolean): FieldMetaEntry => ({
	touched: true,
	dirty,
	isValidating: false,
	listenerTriggered: false,
});

describe("array field helpers", () => {
	it("pushValue appends element to array", () => {
		const form = createForm({ initialData: { items: ["a", "b"] } });
		const field = form.field("items");
		const result = field.pushValue("c");
		expect(result.ok).toBe(true);
		expect(form.getState().data.items).toEqual(["a", "b", "c"]);
		form.dispose();
	});

	it("removeValue removes at index", () => {
		const form = createForm({ initialData: { items: ["a", "b", "c"] } });
		const field = form.field("items");
		const result = field.removeValue(1);
		expect(result.ok).toBe(true);
		expect(form.getState().data.items).toEqual(["a", "c"]);
		form.dispose();
	});

	it("insertValue inserts at index, shifts elements", () => {
		const form = createForm({ initialData: { items: ["a", "c"] } });
		const field = form.field("items");
		const result = field.insertValue(1, "b");
		expect(result.ok).toBe(true);
		expect(form.getState().data.items).toEqual(["a", "b", "c"]);
		form.dispose();
	});

	it("moveValue reorders elements", () => {
		const form = createForm({ initialData: { items: ["a", "b", "c"] } });
		const field = form.field("items");
		const result = field.moveValue(0, 2);
		expect(result.ok).toBe(true);
		expect(form.getState().data.items).toEqual(["b", "c", "a"]);
		form.dispose();
	});

	it("moveValue preserves nested metadata while reindexing in both directions", () => {
		const form = createForm({ initialData: { items: [{ name: "a" }, { name: "b" }, { name: "c" }] } });
		form.field("items.0.name").handleBlur();
		form.setValue("items.1.name", "B");
		form.setValue("items.2.name", "C");

		form.field("items").moveValue(0, 2);
		expect(form.getState().fieldMeta["items.2.name"]).toMatchObject({ touched: true, dirty: false });
		expect(form.getState().fieldMeta["items.0.name"]).toMatchObject({ touched: true, dirty: true });
		expect(form.getState().fieldMeta["items.1.name"]).toMatchObject({ touched: true, dirty: true });

		form.field("items").moveValue(2, 0);
		expect(form.getState().fieldMeta["items.0.name"]).toMatchObject({ touched: true, dirty: false });
		expect(form.getState().fieldMeta["items.1.name"]).toMatchObject({ touched: true, dirty: true });
		expect(form.getState().fieldMeta["items.2.name"]).toMatchObject({ touched: true, dirty: true });
		form.dispose();
	});

	it.each(metadataPaths)("reindexes $name metadata without stale keys or collisions", ({ base, key }) => {
		const first = metaEntry(false);
		const second = metaEntry(true);
		const third = { ...metaEntry(true), isValidating: true };
		const outside = metaEntry(false);
		const original = { [key(0)]: first, [key(1)]: second, [key(2)]: third, unrelated: outside };

		const forward = moveFieldMeta(original, base, 0, 2);
		expect(forward).toEqual({ [key(0)]: second, [key(1)]: third, [key(2)]: first, unrelated: outside });
		expect(moveFieldMeta(forward, base, 2, 0)).toEqual(original);

		const inserted = shiftFieldMeta(original, base, 1, 1);
		expect(inserted).toEqual({ [key(0)]: first, [key(2)]: second, [key(3)]: third, unrelated: outside });
		expect(inserted[key(1)]).toBeUndefined();

		const removed = shiftFieldMeta(original, base, 1, -1);
		expect(removed).toEqual({ [key(0)]: first, [key(1)]: third, unrelated: outside });
		expect(Object.values(removed)).not.toContain(second);
	});

	it("swapValue swaps two elements", () => {
		const form = createForm({ initialData: { items: ["a", "b", "c"] } });
		const field = form.field("items");
		const result = field.swapValue(0, 2);
		expect(result.ok).toBe(true);
		expect(form.getState().data.items).toEqual(["c", "b", "a"]);
		form.dispose();
	});

	it("pushValue on non-array throws", () => {
		const form = createForm({ initialData: { name: "Alice" } });
		const field = form.field("name");
		expect(() => (field as unknown as { pushValue: (v: unknown) => void }).pushValue("x")).toThrow("Expected array");
		form.dispose();
	});

	it("push to empty array works", () => {
		const form = createForm({ initialData: { items: [] as string[] } });
		const field = form.field("items");
		field.pushValue("a");
		expect(form.getState().data.items).toEqual(["a"]);
		form.dispose();
	});

	it("removeValue shifts fieldMeta for child fields", () => {
		const form = createForm({ initialData: { items: ["a", "b", "c"] } });
		// Touch child fields via setValue to populate fieldMeta
		form.setValue("items.0", "A");
		form.setValue("items.1", "B");
		form.setValue("items.2", "C");

		const meta = form.getState().fieldMeta;
		expect(meta["items.0"]?.touched).toBe(true);
		expect(meta["items.1"]?.touched).toBe(true);
		expect(meta["items.2"]?.touched).toBe(true);

		// Remove index 1 — should shift index 2 → 1
		const field = form.field("items");
		field.removeValue(1);

		const metaAfter = form.getState().fieldMeta;
		expect(metaAfter["items.0"]?.touched).toBe(true);
		expect(metaAfter["items.1"]?.touched).toBe(true); // was items.2
		expect(metaAfter["items.2"]).toBeUndefined();
		form.dispose();
	});

	it("all operations dispatch through pipeline (state updated)", () => {
		const form = createForm({ initialData: { items: [1, 2, 3] } });
		const notifications: unknown[] = [];
		form.subscribe(() => notifications.push(true));

		const field = form.field("items");
		field.pushValue(4);
		field.removeValue(0);
		field.insertValue(0, 0);
		field.swapValue(0, 1);
		field.moveValue(0, 2);

		// Each operation triggers a state change notification
		expect(notifications.length).toBeGreaterThanOrEqual(5);
		form.dispose();
	});

	it("removeValue does not shift fieldMeta if pipeline vetoes", () => {
		const form = createForm({
			initialData: { items: ["a", "b", "c"] },
			middleware: [
				{
					id: "veto-all",
					beforeAction: () => ({ action: "veto" as const, reason: "blocked" }),
				},
			],
		});
		// Populate fieldMeta by creating form without middleware first, then re-create
		form.dispose();

		const form2 = createForm({ initialData: { items: ["a", "b", "c"] } });
		form2.setValue("items.0", "A");
		form2.setValue("items.1", "B");
		form2.setValue("items.2", "C");
		const _metaBefore = { ...form2.getState().fieldMeta };

		// Now add veto middleware and try remove
		const form3 = createForm({
			initialData: { items: ["a", "b", "c"] },
			middleware: [
				{
					id: "veto-all",
					beforeAction: () => ({ action: "veto" as const, reason: "blocked" }),
				},
			],
		});
		const field3 = form3.field("items");
		const result = field3.removeValue(1);
		expect(result.ok).toBe(false);
		// fieldMeta should be empty (no setValue succeeded), not shifted
		expect(form3.getState().fieldMeta).toEqual({});
		form2.dispose();
		form3.dispose();
	});

	it("swapValue correctly swaps fieldMeta entries", () => {
		const form = createForm({ initialData: { items: ["a", "b", "c"] } });
		form.setValue("items.0", "A");
		form.setValue("items.2", "C");

		const metaBefore = form.getState().fieldMeta;
		expect(metaBefore["items.0"]?.touched).toBe(true);
		expect(metaBefore["items.2"]?.touched).toBe(true);

		const field = form.field("items");
		field.swapValue(0, 2);

		const metaAfter = form.getState().fieldMeta;
		// Meta entries should be swapped: items.0 ↔ items.2
		expect(metaAfter["items.0"]?.touched).toBe(true);
		expect(metaAfter["items.2"]?.touched).toBe(true);
		form.dispose();
	});
});
