import { describe, expect, it } from "vitest";
import { jsonSchemaProvider, projectSchema } from "../index.js";

describe("selected root default evidence", () => {
	it("retains only root-property occurrences and their own or referenced annotations", () => {
		const descriptors = projectSchema(
			{
				type: "object",
				default: { other: "root" },
				properties: {
					name: { type: "string", default: "Ada" },
					city: { $ref: "#/$defs/city", default: "Lyon" },
					fallback: { $ref: "#/$defs/city" },
					nested: { type: "object", properties: { child: { default: "hidden" } } },
					items: { type: "array", minItems: 1, items: { default: "hidden" } },
					constant: { const: "not-default" },
				},
				$defs: { city: { type: "string", default: "Paris" } },
			},
			{ provider: jsonSchemaProvider(), side: "input" },
		).descriptors;
		const root = descriptors.occurrences[descriptors.rootOccurrenceId];
		const properties = root.children
			.map((id) => descriptors.occurrences[id])
			.filter((item) => item.relation === "property");
		expect(properties.map((item) => item.key)).toEqual(["name", "city", "fallback", "nested", "items", "constant"]);
		expect(descriptors.evidence[root.nodeId].default).toEqual({ other: "root" });
		const city = properties[1];
		expect(descriptors.evidence[city.nodeId].default).toBe("Lyon");
		expect(descriptors.evidence[descriptors.occurrences[city.children[0]].nodeId].default).toBe("Paris");
		expect(descriptors.evidence[properties[5].nodeId].default).toBeUndefined();
		expect(descriptors.evidence[properties[4].nodeId].minItems).toBe(1);
	});

	it("limits and cycles are explicit; scalar root default is not a property", () => {
		const schema = { type: "object", properties: { value: { default: "ok" } } };
		const limited = projectSchema(schema, {
			provider: jsonSchemaProvider(),
			side: "input",
			projectionLimits: { maxOccurrences: 1 },
		}).descriptors;
		expect(limited.occurrences[limited.occurrences[limited.rootOccurrenceId].children[0]].expansion).toBe("limit");
		const scalar = projectSchema(
			{ type: "string", default: "root" },
			{ provider: jsonSchemaProvider(), side: "input" },
		).descriptors;
		expect(scalar.occurrences[scalar.rootOccurrenceId].children).toEqual([]);
	});
});
