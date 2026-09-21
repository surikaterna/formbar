import { describe, expect, it, vi } from "vitest";
import { z as z3 } from "zod3-current";
import { z as z4 } from "zod4-current";
import { type DescriptorDocument, jsonSchemaProvider, projectSchema, zod3Provider, zod4Provider } from "../index.js";

function rootEvidence(document: DescriptorDocument) {
	const occurrence = document.occurrences[document.rootOccurrenceId];
	return document.evidence[occurrence.nodeId];
}

function evidence(schema: unknown, provider: Parameters<typeof projectSchema>[1]["provider"]) {
	return rootEvidence(projectSchema(schema, { provider, side: "input" }).descriptors);
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
