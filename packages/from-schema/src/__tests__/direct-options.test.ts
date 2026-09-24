import type { FormNode } from "@formbar/declarative";
import { describe, expect, it } from "vitest";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";

const prepare = (schema: unknown) => createSchemaForm(schema, { provider: jsonSchemaProvider(), side: "input" });
const fields = (node: FormNode): FormNode[] =>
	"children" in node ? node.children.flatMap(fields) : node.type === "field" ? [node] : [];

describe("direct JSON Schema option presentation", () => {
	it("decorates canonical typed choices in order without coercion or extending the enum", () => {
		const result = prepare({
			type: "integer",
			enum: [1, 2, 3],
			"x-formbar": {
				options: [
					{ value: 2, title: "Two", disabled: true },
					{ value: "1", title: "Wrong type" },
					{ value: 1, title: "One" },
					{ value: 1, title: "Duplicate" },
					3,
				],
			},
		});
		expect(result.definition.root).toMatchObject({
			widget: "select",
			props: {
				options: { value: [{ value: 1, title: "One" }, { value: 2, title: "Two", disabled: true }, { value: 3 }] },
			},
		});
		expect(result.diagnostics.compilation).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "unmatched-option", index: 1 }),
				expect.objectContaining({ code: "duplicate-option", index: 3 }),
			]),
		);
		expect(result.sourceValidator).toBeUndefined();
	});

	it("supports options-only, items and expanded refs without adding schema constraints", () => {
		const options = [{ value: "a", title: "Alpha" }, "b"];
		const array = prepare({ type: "array", items: { type: "string", "x-formbar": { options } } });
		expect(fields(array.definition.root)[0]).toMatchObject({
			widget: "select",
			props: { options: { value: [{ value: "a", title: "Alpha" }, { value: "b" }] } },
		});
		const ref = prepare({
			$ref: "#/$defs/item",
			$defs: { item: { type: "string", enum: ["b", "a"], "x-formbar": { options } } },
		});
		expect(ref.definition.root).toMatchObject({
			widget: "select",
			props: { options: { value: [{ value: "b" }, { value: "a", title: "Alpha" }] } },
		});
	});

	it("warns on invalid entries and preserves explicit extension options priority", () => {
		const result = prepare({
			type: "string",
			"x-formbar": { options: [{ value: "a", disabled: "yes" }, { value: "b", extra: 1 }, "ok"] },
		});
		expect(result.definition.root).toMatchObject({
			widget: "select",
			props: { options: { value: [{ value: "ok" }] } },
		});
		expect(
			result.diagnostics.compilation
				.filter((diagnostic) => diagnostic.code === "invalid-option")
				.map((diagnostic) => diagnostic.index),
		).toEqual([0, 1]);
		const override = prepare({
			type: "string",
			"x-formbar": { widget: "select", options: ["ignored"], props: { options: ["explicit"] } },
		});
		expect(override.definition.root).toMatchObject({ props: { options: { value: ["explicit"] } } });
		const inferredOverride = prepare({
			type: "string",
			"x-formbar": { options: ["ignored"], props: { options: ["explicit"] } },
		});
		expect(inferredOverride.definition.root).toMatchObject({
			widget: "select",
			props: { options: { value: ["explicit"] } },
		});
	});

	it("rejects accessor and prototype-bearing hints without executing option getters", () => {
		let invoked = 0;
		const entry = Object.defineProperty({}, "value", {
			enumerable: true,
			get() {
				invoked++;
				return "a";
			},
		});
		const result = prepare({ type: "string", enum: ["a"], "x-formbar": { options: [entry] } });
		expect(invoked).toBe(0);
		expect(result.definition.root).toMatchObject({ widget: "unsupported" });
		expect(result.diagnostics.compilation).toContainEqual(expect.objectContaining({ code: "invalid-extension-props" }));
		expect(result.diagnostics.compilation).toContainEqual(expect.objectContaining({ code: "invalid-option" }));
		const forged = Object.create({ value: "a" });
		expect(
			prepare({ type: "string", enum: ["a"], "x-formbar": { options: [forged] } }).diagnostics.compilation,
		).toContainEqual(expect.objectContaining({ code: "invalid-extension-props" }));
	});

	it("does not infer options across composed branches", () => {
		const result = prepare({
			anyOf: [{ type: "string", enum: ["a"], "x-formbar": { options: [{ value: "a", title: "A" }] } }],
		});
		expect(result.definition.root).toMatchObject({ widget: "unsupported" });
	});
});
