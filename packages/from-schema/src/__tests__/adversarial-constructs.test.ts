import type { DocumentContext, Side } from "@scheman/core";
import { describe, expect, it } from "vitest";
import { z as z4 } from "zod4-current";
import {
	compileDefaultKaladaV1Definition,
	jsonSchemaProvider,
	projectSchema,
	standardSchemaProvider,
	zod4Provider,
} from "../index.js";

function projectAndCompile(schema: unknown, provider = jsonSchemaProvider()) {
	const descriptors = projectSchema(schema, { provider, side: "input" }).descriptors;
	return { descriptors, compile: () => compileDefaultKaladaV1Definition(descriptors) };
}

describe("adversarial schema constructs", () => {
	it("retains unresolved refs but refuses to generate an unbound fallback", () => {
		const { descriptors, compile } = projectAndCompile({ $ref: "https://example.test/remote.json" });
		const root = descriptors.nodes[descriptors.occurrences[descriptors.rootOccurrenceId].nodeId];
		expect(root).toMatchObject({ kind: "ref", reference: "https://example.test/remote.json" });
		if (root.kind === "ref") expect(root.unresolved).toBeTruthy();
		expect(compile).toThrow("Kalada V1 generation requires a complete input-side schema projection.");
	});

	it("follows supported wrappers without losing the binding", () => {
		const { descriptors, compile } = projectAndCompile(z4.string().optional(), zod4Provider());
		expect(
			Object.values(descriptors.nodes).some((node) => node.kind === "wrapper" && node.wrapper === "optional"),
		).toBe(true);
		expect(compile().root).toMatchObject({
			type: "field",
			widget: "text",
			binding: { namespace: "data", segments: [] },
		});
	});

	it("retains tuple items/rest but rejects non-repeater projection", () => {
		const { descriptors, compile } = projectAndCompile({
			type: "array",
			prefixItems: [{ type: "string" }],
			items: { type: "number" },
		});
		const relations = Object.values(descriptors.occurrences).map((item) => item.relation);
		expect(relations).toEqual(expect.arrayContaining(["tuple-item", "tuple-rest"]));
		expect(compile).toThrow("root: tuple requires authored Kalada V1 presentation.");
	});

	it("retains records and refuses to invent a dynamic-key presentation", () => {
		const provider = recordProvider();
		const { descriptors, compile } = projectAndCompile({}, provider);
		const root = descriptors.nodes[descriptors.occurrences[descriptors.rootOccurrenceId].nodeId];
		expect(root).toMatchObject({ kind: "record", exhaustive: "unknown" });
		expect(compile).toThrow("root: record requires authored Kalada V1 presentation.");
	});

	it("retains applicator branches but rejects inferred presentation", () => {
		const { descriptors, compile } = projectAndCompile({
			type: "object",
			properties: { enabled: { type: "boolean" } },
			if: { properties: { enabled: { const: true } } },
			then: { required: ["enabled"] },
		});
		const applicators = Object.values(descriptors.occurrences).filter((item) => item.relation === "applicator");
		expect(applicators).toHaveLength(2);
		expect(compile).toThrow("root: schema applicators require authored Kalada presentation.");
	});

	it("distinguishes unavailable and opaque evidence while refusing both", () => {
		const standard = {
			"~standard": { version: 1 as const, vendor: "opaque", validate: (value: unknown) => ({ value }) },
		};
		const unavailable = projectAndCompile(standard, standardSchemaProvider());
		expect(unavailable.descriptors.source.availability).toBe("unavailable");
		expect(unavailable.compile).toThrow("Kalada V1 generation requires a complete input-side schema projection.");

		const opaque = projectAndCompile({}, opaqueProvider());
		expect(
			opaque.descriptors.nodes[opaque.descriptors.occurrences[opaque.descriptors.rootOccurrenceId].nodeId],
		).toMatchObject({
			kind: "opaque",
			reason: "vendor-internals",
		});
		expect(opaque.compile).toThrow("Kalada V1 generation requires a complete input-side schema projection.");
	});

	it.each([
		["null", z4.null()],
		["undefined", z4.undefined()],
		["void", z4.void()],
		["bigint", z4.bigint()],
		["symbol", z4.symbol()],
		["NaN", z4.nan()],
	])("rejects unsupported %s primitives at the generated root", (_name, schema) => {
		const { compile } = projectAndCompile(schema, zod4Provider());
		expect(compile).toThrow("root: non-JSON primitive requires an authored field.");
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
