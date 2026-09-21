import { describe, expect, it, vi } from "vitest";
import { z as z3 } from "zod3-current";
import { z as z3min } from "zod3-min";
import { z as z4 } from "zod4-current";
import { z as z4min } from "zod4-min";
import {
	type DescriptorDocument,
	compileDefaultFormDefinition,
	jsonSchemaProvider,
	projectSchema,
	zod3Provider,
	zod4Provider,
} from "../index.js";

function rootEvidence(document: DescriptorDocument) {
	const occurrence = document.occurrences[document.rootOccurrenceId];
	return document.evidence[occurrence.nodeId];
}

function evidence(schema: unknown, provider: Parameters<typeof projectSchema>[1]["provider"]) {
	return rootEvidence(projectSchema(schema, { provider, side: "input" }).descriptors);
}

function compiledRoot(schema: unknown, provider: Parameters<typeof projectSchema>[1]["provider"]) {
	const descriptors = projectSchema(schema, { provider, side: "input" }).descriptors;
	return compileDefaultFormDefinition(descriptors).definition?.root;
}

describe("provider-neutral normalized evidence", () => {
	it("normalizes equivalent string bounds, patterns, and formats across JSON Schema and Zod", () => {
		const expected = evidence(
			{ type: "string", minLength: 2, maxLength: 8, pattern: "^[a]+$", format: "email" },
			jsonSchemaProvider(),
		);
		expect(
			evidence(
				z3
					.string()
					.min(2)
					.max(8)
					.regex(/^[a]+$/)
					.email(),
				zod3Provider(),
			),
		).toEqual(expected);
		expect(
			evidence(
				z4
					.string()
					.min(2)
					.max(8)
					.regex(/^[a]+$/)
					.email(),
				zod4Provider(),
			),
		).toEqual(expected);
	});

	it("normalizes integer and inclusive number bounds across providers", () => {
		const expected = evidence({ type: "integer", minimum: 1, maximum: 9 }, jsonSchemaProvider());
		expect(evidence(z3.number().min(1).max(9).int(), zod3Provider())).toEqual(expected);
		expect(evidence(z4.number().min(1).max(9).int(), zod4Provider())).toEqual(expected);
	});

	it("normalizes array bounds without invoking item accessors", () => {
		const expected = evidence({ type: "array", minItems: 2, maxItems: 4, items: true }, jsonSchemaProvider());
		expect(evidence(z3.array(z3.string()).min(2).max(4), zod3Provider())).toEqual(expected);
		expect(evidence(z4.array(z4.string()).min(2).max(4), zod4Provider())).toEqual(expected);
	});

	it("normalizes exact string lengths to matching minimum and maximum evidence", () => {
		const expected = evidence({ type: "string", minLength: 3, maxLength: 3 }, jsonSchemaProvider());
		expect(evidence(z3min.string().length(3), zod3Provider())).toEqual(expected);
		expect(evidence(z3.string().length(3), zod3Provider())).toEqual(expected);
		expect(evidence(z4min.string().length(3), zod4Provider())).toEqual(expected);
		expect(evidence(z4.string().length(3), zod4Provider())).toEqual(expected);
	});

	it("normalizes exact array lengths and compiles equivalent repeater bounds", () => {
		const json = { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } };
		const expected = evidence(json, jsonSchemaProvider());
		expect(evidence(z3min.array(z3min.string()).length(3), zod3Provider())).toEqual(expected);
		expect(evidence(z3.array(z3.string()).length(3), zod3Provider())).toEqual(expected);
		expect(evidence(z4min.array(z4min.string()).length(3), zod4Provider())).toEqual(expected);
		expect(evidence(z4.array(z4.string()).length(3), zod4Provider())).toEqual(expected);
		for (const [schema, provider] of [
			[json, jsonSchemaProvider()],
			[z3.array(z3.string()).length(3), zod3Provider()],
			[z4.array(z4.string()).length(3), zod4Provider()],
		] as const) {
			expect(compiledRoot(schema, provider)).toMatchObject({ type: "repeater", minItems: 3, maxItems: 3 });
		}
	});

	it("intersects repeated string and array bounds restrictively", () => {
		const expectedString = evidence({ type: "string", minLength: 3, maxLength: 8 }, jsonSchemaProvider());
		expect(evidence(z3min.string().min(2).min(3).max(9).max(8), zod3Provider())).toEqual(expectedString);
		expect(evidence(z3.string().min(2).min(3).max(9).max(8), zod3Provider())).toEqual(expectedString);
		expect(evidence(z4min.string().min(2).min(3).max(9).max(8), zod4Provider())).toEqual(expectedString);
		expect(evidence(z4.string().min(2).min(3).max(9).max(8), zod4Provider())).toEqual(expectedString);
		const expectedArray = evidence({ type: "array", minItems: 3, maxItems: 8, items: true }, jsonSchemaProvider());
		expect(evidence(z3min.array(z3min.string()).min(2).min(3).max(9).max(8), zod3Provider())).toEqual(expectedArray);
		expect(evidence(z3.array(z3.string()).min(2).min(3).max(9).max(8), zod3Provider())).toEqual(expectedArray);
		expect(evidence(z4min.array(z4min.string()).min(2).min(3).max(9).max(8), zod4Provider())).toEqual(expectedArray);
		expect(evidence(z4.array(z4.string()).min(2).min(3).max(9).max(8), zod4Provider())).toEqual(expectedArray);
	});

	it("selects the restrictive effective inclusive or exclusive numeric bound", () => {
		const expected = evidence({ type: "number", exclusiveMinimum: 3, maximum: 8 }, jsonSchemaProvider());
		expect(evidence(z3.number().min(2).gt(3).max(9).max(8), zod3Provider())).toEqual(expected);
		expect(evidence(z4.number().min(2).gt(3).max(9).max(8), zod4Provider())).toEqual(expected);
		const inclusiveWins = evidence({ type: "number", minimum: 3, exclusiveMaximum: 8 }, jsonSchemaProvider());
		expect(evidence(z3.number().gt(2).min(3).max(9).lt(8), zod3Provider())).toEqual(inclusiveWins);
		expect(evidence(z4.number().gt(2).min(3).max(9).lt(8), zod4Provider())).toEqual(inclusiveWins);
	});

	it("does not expose or execute deferred default factories", () => {
		const factory = vi.fn(() => "generated");
		const descriptor = projectSchema(z4.string().default(factory), {
			provider: zod4Provider(),
			side: "input",
		}).descriptors;
		expect(factory).not.toHaveBeenCalled();
		expect(rootEvidence(descriptor)).not.toHaveProperty("default");
		const root = descriptor.nodes[descriptor.occurrences[descriptor.rootOccurrenceId].nodeId];
		expect(root).toMatchObject({ kind: "wrapper", value: { status: "deferred", kind: "default" } });
	});
});
