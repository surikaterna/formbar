import { describe, expect, it } from "vitest";
import { z as z4 } from "zod4-current";
import { z as z4min } from "zod4-min";
import { compileDefaultFormDefinition, projectSchema, zod4Provider } from "../index.js";

const metadataCases = [
	["4.0.0 describe", () => z4min.object({ name: z4min.string() }).describe("Person section"), false],
	["4.5.4 describe", () => z4.object({ name: z4.string() }).describe("Person section"), false],
	[
		"4.0.0 meta",
		() => z4min.object({ name: z4min.string() }).meta({ title: "Person", description: "Person section" }),
		true,
	],
	["4.5.4 meta", () => z4.object({ name: z4.string() }).meta({ title: "Person", description: "Person section" }), true],
] as const;

describe("Zod 4 public metadata adaptation", () => {
	it.each(metadataCases)("projects unprimed %s metadata on first use", (_name, createSchema, titled) => {
		const schema = createSchema();
		const descriptors = projectSchema(schema, {
			provider: zod4Provider({ execution: { shape: "allow", metadata: "allow" } }),
			side: "input",
		}).descriptors;
		const occurrence = descriptors.occurrences[descriptors.rootOccurrenceId];
		expect(descriptors.nodes[occurrence.nodeId].metadata).toMatchObject({
			annotations: {
				...(titled ? { title: "Person" } : {}),
				description: "Person section",
			},
		});
		expect(compileDefaultFormDefinition(descriptors).definition?.root).toMatchObject({
			type: "section",
			...(titled ? { title: "Person" } : {}),
			description: "Person section",
		});
	});

	it("adapts unprimed metadata for nested Zod 4.5 schemas", () => {
		const schema = z4.object({ child: z4.object({ name: z4.string() }).describe("Nested section") });
		const descriptors = projectSchema(schema, {
			provider: zod4Provider({ execution: { shape: "allow", metadata: "allow" } }),
			side: "input",
		}).descriptors;
		const child = Object.values(descriptors.occurrences).find((occurrence) => occurrence.key === "child");
		if (!child) throw new Error("missing nested occurrence");
		expect(descriptors.nodes[child.nodeId].metadata).toMatchObject({
			annotations: { description: "Nested section" },
		});
		expect(compileDefaultFormDefinition(descriptors).definition?.root).toMatchObject({
			type: "group",
			children: [expect.objectContaining({ type: "section", description: "Nested section" })],
		});
	});

	it.each(metadataCases)("performs zero %s metadata execution when permission is denied", (_name, createSchema) => {
		let metadataExecutions = 0;
		const schema = new Proxy(createSchema(), {
			get(target, key, receiver) {
				if (key === "meta") metadataExecutions += 1;
				return Reflect.get(target, key, receiver);
			},
			getOwnPropertyDescriptor(target, key) {
				const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
				if (key !== "meta" || !descriptor || !("value" in descriptor) || typeof descriptor.value !== "function") {
					return descriptor;
				}
				return {
					...descriptor,
					value: (...args: unknown[]) => {
						metadataExecutions += 1;
						return Reflect.apply(descriptor.value, target, args);
					},
				};
			},
		});
		const descriptors = projectSchema(schema, {
			provider: zod4Provider({ execution: { shape: "allow", metadata: "deny" } }),
			side: "input",
		}).descriptors;
		expect(metadataExecutions).toBe(0);
		const occurrence = descriptors.occurrences[descriptors.rootOccurrenceId];
		expect(descriptors.nodes[occurrence.nodeId].metadata).toEqual({});
	});
});
