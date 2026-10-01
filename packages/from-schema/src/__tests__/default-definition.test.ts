import { describe, expect, it } from "vitest";
import { compileKaladaDefaults } from "../compiler/compile-kalada-defaults.js";
import {
	compileDefaultFormDefinition,
	compileDefaultKaladaV1Definition,
	jsonSchemaProvider,
	projectSchema,
} from "../index.js";
import { hostSchema, validationHost } from "./kalada-validation-host-408.js";

const provider = jsonSchemaProvider();
const generated = (schema: unknown) =>
	compileDefaultFormDefinition(projectSchema(schema, { provider, side: "input" }).descriptors).definition;

describe("direct Kalada V1 schema generation", () => {
	it("generates canonical scalar, object and nested array bindings without legacy operations", () => {
		const scalar = generated({ type: "string" });
		expect(scalar.root).toMatchObject({ type: "field", binding: { namespace: "data", segments: [] }, widget: "text" });
		const schema = {
			type: "object",
			additionalProperties: false,
			required: ["rows"],
			properties: {
				rows: {
					type: "array",
					items: {
						type: "object",
						additionalProperties: false,
						properties: { cells: { type: "array", items: { type: "string" } } },
					},
				},
			},
		};
		const nested = generated(schema);
		const outer = (
			nested.root as {
				children: Array<{
					scope: string;
					children: Array<{ children: Array<{ scope: string; children: unknown[] }> }>;
				}>;
			}
		).children[0];
		const inner = outer.children[0].children[0];
		expect(outer).toMatchObject({ type: "repeater", binding: { namespace: "data", segments: ["rows"] } });
		expect(inner).toMatchObject({
			type: "repeater",
			binding: { namespace: "data", scope: outer.scope, segments: ["cells"] },
		});
		expect(inner.children[0]).toMatchObject({
			type: "field",
			binding: { namespace: "data", scope: inner.scope, segments: [] },
		});
		expect(inner.scope).not.toBe(outer.scope);
		expect(JSON.stringify(nested)).not.toContain('"format":"kalada-program"');
		expect(JSON.stringify(nested)).not.toContain('"kind":"op"');
		expect(nested).toEqual(generated(schema));
	});

	it("rejects unsupported types, malformed defaults, partial projection and wrong side", () => {
		const property = (value: unknown) =>
			generated({ type: "object", additionalProperties: false, properties: { bad: value } });
		expect(() => property({})).toThrow(/root\.children\[0\]:/);
		expect(() =>
			compileKaladaDefaults(
				projectSchema(
					{ type: "object", additionalProperties: false, properties: { bad: { type: "string", default: 4 } } },
					{ provider, side: "input" },
				).descriptors,
			),
		).toThrow(/Invalid schema default/);
		expect(() => property({ type: "null" })).toThrow(
			"root.children[0]: non-JSON primitive requires an authored field.",
		);
		expect(() => property({ oneOf: [{ type: "string" }, { type: "number" }] })).toThrow(/root\.children\[0\]:/);
		expect(() => generated({ type: "object", properties: { dynamic: { type: "string" } } })).toThrow(/root:/);
		const output = projectSchema({ type: "string" }, { provider, side: "output" });
		expect(() => compileDefaultKaladaV1Definition(output.descriptors)).toThrow(/input-side/);
		const limited = projectSchema(
			{ type: "object", properties: { child: { type: "string" } } },
			{
				provider,
				side: "input",
				projectionLimits: { maxOccurrenceDepth: 1 },
			},
		);
		expect(() => compileDefaultKaladaV1Definition(limited.descriptors)).toThrow(/complete input-side/);
	});

	it("initializes valid defaults in the installed host before edits and submission", async () => {
		const schema = {
			...hostSchema,
			properties: {
				...hostSchema.properties,
				profile: {
					...hostSchema.properties.profile,
					properties: { name: { type: "string", default: "seed" } },
				},
			},
		};
		const f = validationHost(schema);
		const initialized = f.host.snapshot();
		expect(initialized.data).toMatchObject({ profile: { name: "seed" } });
		expect(initialized.revision).toBeDefined();
		const field = initialized.controls.find((control) => control.nodeId === f.nameId);
		expect(field?.value).toBe("seed");
		expect(field?.writers.value?.("updated")).toEqual({ status: "applied" });
		expect(f.host.snapshot().revision).not.toBe(initialized.revision);
		expect(await f.host.submit()).toEqual({ status: "submitted" });
		expect(f.installed.instances.values().next().value?.outgoing).toMatchObject({ profile: { name: "updated" } });
		f.host.dispose();
	});
});
