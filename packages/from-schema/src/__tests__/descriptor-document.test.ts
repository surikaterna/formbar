import { describe, expect, it } from "vitest";
import { jsonSchemaProvider, projectSchema } from "../index.js";

describe("descriptor document projection", () => {
	it("retains recursive references, sharing, definitions, metadata, and selected-side provenance", () => {
		const schema = {
			type: "object",
			properties: {
				left: { $ref: "#/$defs/node" },
				right: { $ref: "#/$defs/node" },
			},
			$defs: {
				node: {
					type: "object",
					properties: { value: { type: "string" }, next: { $ref: "#/$defs/node" } },
				},
			},
		};
		const { descriptors } = projectSchema(schema, { provider: jsonSchemaProvider(), side: "input" });
		const references = Object.values(descriptors.nodes).filter((node) => node.kind === "ref");
		expect(references.length).toBeGreaterThanOrEqual(3);
		expect(
			new Set(references.flatMap((node) => (node.kind === "ref" && node.target ? [node.target.nodeId] : []))).size,
		).toBe(1);
		expect(Object.values(descriptors.occurrences).some((item) => item.expansion === "cycle")).toBe(true);
		expect(Object.values(descriptors.occurrences).some((item) => item.shared)).toBe(true);
		expect(descriptors.definitions).toHaveLength(1);
		expect(descriptors.source).toMatchObject({ provider: "json-schema", side: "input", availability: "complete" });
		expect(descriptors.source.metadata).toMatchObject({ dialect: "draft-2020-12" });
	});

	it("selects input and output roots explicitly without opposite-side fallback", () => {
		const provider = {
			name: "sides",
			build: (_source: unknown, context: import("@scheman/core").DocumentContext) => ({
				input: context.node("input", "/input", () => ({ kind: "primitive", type: "string" })),
				output: context.node("output", "/output", () => ({ kind: "primitive", type: "number" })),
			}),
		};
		const input = projectSchema({}, { provider, side: "input" }).descriptors;
		const output = projectSchema({}, { provider, side: "output" }).descriptors;
		expect(input.nodes[input.occurrences[input.rootOccurrenceId].nodeId]).toMatchObject({ type: "string" });
		expect(output.nodes[output.occurrences[output.rootOccurrenceId].nodeId]).toMatchObject({ type: "number" });
		expect(Object.keys(input.nodes)).toHaveLength(1);
		expect(Object.keys(output.nodes)).toHaveLength(1);
	});

	it.each([
		[true, "unconstrained"],
		[false, "never"],
	] as const)("retains boolean JSON Schema %s as %s evidence", (schema, kind) => {
		const { descriptors } = projectSchema(schema, { provider: jsonSchemaProvider(), side: "input" });
		const root = descriptors.occurrences[descriptors.rootOccurrenceId];
		expect(descriptors.nodes[root.nodeId].kind).toBe(kind);
	});

	it("preserves raw metadata and constraints while normalizing passive evidence", () => {
		const { descriptors } = projectSchema(
			{
				type: "string",
				title: "Code",
				default: "A",
				minLength: 2,
				pattern: "^[A-Z]+$",
				format: "token",
				"x-formbar": { widget: "textarea", nested: { untouched: true } },
			},
			{ provider: jsonSchemaProvider(), side: "input" },
		);
		const root = descriptors.occurrences[descriptors.rootOccurrenceId];
		expect(descriptors.nodes[root.nodeId]).toMatchObject({
			metadata: {
				annotations: { title: "Code", default: "A" },
				extensions: { "x-formbar": { nested: { untouched: true } } },
			},
			constraints: { minLength: 2, pattern: "^[A-Z]+$", format: "token" },
		});
		expect(descriptors.evidence[root.nodeId]).toMatchObject({
			primitive: "string",
			default: "A",
			minLength: 2,
			pattern: "^[A-Z]+$",
			format: "token",
		});
	});

	it("applies deterministic bounded occurrence expansion independently of Scheman limits", () => {
		const schema = { type: "object", properties: { first: { type: "string" }, second: { type: "number" } } };
		const options = { provider: jsonSchemaProvider(), side: "input" as const, projectionLimits: { maxOccurrences: 1 } };
		const first = projectSchema(schema, options).descriptors;
		const second = projectSchema(schema, options).descriptors;
		expect(first).toEqual(second);
		expect(Object.keys(first.occurrences)).toHaveLength(1);
		expect(first.projectionDiagnostics.map((item) => item.code)).toEqual([
			"occurrence-limit",
			"occurrence-limit",
			"occurrence-limit",
		]);
	});

	it("forwards Scheman document limits to the explicit provider", () => {
		let maxNodes = 0;
		const provider = {
			name: "limit-observer",
			build: (_source: unknown, context: import("@scheman/core").DocumentContext) => {
				maxNodes = context.limits.maxNodes;
				const input = context.node("input", "", () => ({ kind: "primitive", type: "string" }));
				const output = context.node("output", "", () => ({ kind: "primitive", type: "string" }));
				return { input, output };
			},
		};
		projectSchema({}, { provider, side: "input", limits: { maxNodes: 7 } });
		expect(maxNodes).toBe(7);
	});
});
