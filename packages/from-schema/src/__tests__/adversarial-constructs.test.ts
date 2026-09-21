import type { DocumentContext, Side } from "@scheman/core";
import { describe, expect, it } from "vitest";
import { z as z4 } from "zod4-current";
import {
	compileDefaultFormDefinition,
	jsonSchemaProvider,
	projectSchema,
	standardSchemaProvider,
	zod4Provider,
} from "../index.js";

function projectAndCompile(schema: unknown, provider = jsonSchemaProvider()) {
	const descriptors = projectSchema(schema, { provider, side: "input" }).descriptors;
	const compiled = compileDefaultFormDefinition(descriptors);
	if (!compiled.definition) throw new Error(JSON.stringify(compiled.definitionDiagnostics));
	return { descriptors, compiled };
}

describe("adversarial schema constructs", () => {
	it("retains unresolved refs and compiles an explicit fallback", () => {
		const { descriptors, compiled } = projectAndCompile({ $ref: "https://example.test/remote.json" });
		const root = descriptors.nodes[descriptors.occurrences[descriptors.rootOccurrenceId].nodeId];
		expect(root).toMatchObject({ kind: "ref", reference: "https://example.test/remote.json" });
		if (root.kind === "ref") expect(root.unresolved).toBeTruthy();
		expect(compiled.definition.root).toMatchObject({ type: "field", widget: "unsupported" });
		expect(compiled.diagnostics).toEqual([expect.objectContaining({ code: "unsupported-schema" })]);
	});

	it("follows supported wrappers without losing the binding", () => {
		const { descriptors, compiled } = projectAndCompile(z4.string().optional(), zod4Provider());
		expect(
			Object.values(descriptors.nodes).some((node) => node.kind === "wrapper" && node.wrapper === "optional"),
		).toBe(true);
		expect(compiled.definition.root).toMatchObject({
			type: "field",
			widget: "text",
			binding: { namespace: "data", segments: [] },
		});
	});

	it("retains tuple items/rest and renders rest as an explicit fallback", () => {
		const { descriptors, compiled } = projectAndCompile({
			type: "array",
			prefixItems: [{ type: "string" }],
			items: { type: "number" },
		});
		const relations = Object.values(descriptors.occurrences).map((item) => item.relation);
		expect(relations).toEqual(expect.arrayContaining(["tuple-item", "tuple-rest"]));
		expect(compiled.definition.root).toMatchObject({
			type: "group",
			children: [
				expect.objectContaining({ type: "field", widget: "text" }),
				expect.objectContaining({ type: "field", widget: "unsupported" }),
			],
		});
		expect(compiled.diagnostics.some((item) => item.message.includes("Tuple rest"))).toBe(true);
	});

	it("retains records and refuses to invent a dynamic-key presentation", () => {
		const provider = recordProvider();
		const { descriptors, compiled } = projectAndCompile({}, provider);
		const root = descriptors.nodes[descriptors.occurrences[descriptors.rootOccurrenceId].nodeId];
		expect(root).toMatchObject({ kind: "record", exhaustive: "unknown" });
		expect(compiled.definition.root).toMatchObject({ type: "field", widget: "unsupported" });
		expect(compiled.diagnostics).toEqual([expect.objectContaining({ code: "unsupported-schema" })]);
	});

	it("retains applicator branches and emits fallback presentation nodes", () => {
		const { descriptors, compiled } = projectAndCompile({
			type: "object",
			properties: { enabled: { type: "boolean" } },
			if: { properties: { enabled: { const: true } } },
			then: { required: ["enabled"] },
		});
		const applicators = Object.values(descriptors.occurrences).filter((item) => item.relation === "applicator");
		expect(applicators).toHaveLength(2);
		expect(compiled.definition.root).toMatchObject({
			type: "group",
			children: expect.arrayContaining([
				expect.objectContaining({ type: "field", widget: "checkbox" }),
				expect.objectContaining({ type: "field", widget: "unsupported" }),
			]),
		});
		expect(compiled.diagnostics.filter((item) => item.message.includes("Applicator branch"))).toHaveLength(2);
	});

	it("distinguishes unavailable and opaque evidence while compiling both visibly", () => {
		const standard = {
			"~standard": { version: 1 as const, vendor: "opaque", validate: (value: unknown) => ({ value }) },
		};
		const unavailable = projectAndCompile(standard, standardSchemaProvider());
		expect(unavailable.descriptors.source.availability).toBe("unavailable");
		expect(unavailable.compiled.definition.root).toMatchObject({ widget: "unsupported" });

		const opaque = projectAndCompile({}, opaqueProvider());
		expect(
			opaque.descriptors.nodes[opaque.descriptors.occurrences[opaque.descriptors.rootOccurrenceId].nodeId],
		).toMatchObject({
			kind: "opaque",
			reason: "vendor-internals",
		});
		expect(opaque.compiled.diagnostics).toEqual([expect.objectContaining({ code: "opaque-schema" })]);
	});

	it.each([
		["null", z4.null()],
		["undefined", z4.undefined()],
		["void", z4.void()],
		["bigint", z4.bigint()],
		["symbol", z4.symbol()],
		["NaN", z4.nan()],
	])("compiles unsupported %s primitives to diagnosed fallback nodes", (_name, schema) => {
		const { compiled } = projectAndCompile(schema, zod4Provider());
		expect(compiled.definition.root).toMatchObject({ type: "field", widget: "unsupported" });
		expect(compiled.diagnostics).toEqual([expect.objectContaining({ code: "unsupported-schema" })]);
	});
});

function recordProvider() {
	return {
		name: "record-fixture",
		build: (_source: unknown, context: DocumentContext) => ({
			input: recordNode(context, "input"),
			output: recordNode(context, "output"),
		}),
	};
}

function recordNode(context: DocumentContext, side: Side) {
	const key = context.node(side, "/key", () => ({ kind: "primitive", type: "string" }));
	const value = context.node(side, "/value", () => ({ kind: "primitive", type: "number" }));
	return context.node(side, "", () => ({ kind: "record", key, value, exhaustive: "unknown" }));
}

function opaqueProvider() {
	return {
		name: "opaque-fixture",
		build: (_source: unknown, context: DocumentContext) => ({
			input: context.node("input", "", () => ({ kind: "opaque", reason: "vendor-internals" })),
			output: context.node("output", "", () => ({ kind: "unknown", reason: "not-selected" })),
		}),
	};
}
