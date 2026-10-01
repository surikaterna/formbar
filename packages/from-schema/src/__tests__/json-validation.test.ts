import { describe, expect, it, vi } from "vitest";
import { createJsonSchemaValidator, preflightJsonSchema } from "../index.js";
import { hostSchema, validationHost } from "./kalada-validation-host-408.js";

describe("#376/#408 host-installed JSON Schema validation", () => {
	it("enforces local refs on generated fields before host submission", async () => {
		const schema = {
			...hostSchema,
			$defs: { named: { type: "string", minLength: 2 } },
			properties: {
				...hostSchema.properties,
				profile: { ...hostSchema.properties.profile, properties: { name: { $ref: "#/$defs/named" } } },
			},
		};
		const f = validationHost(schema);
		const name = f.host.snapshot().controls.find((control) => control.nodeId === f.nameId);
		expect(name?.writers.value?.("x")).toEqual({ status: "applied" });
		expect(await f.host.submit()).toEqual({ status: "denied" });
		expect(f.host.snapshot().lifecycle?.issues.schema).not.toEqual([]);
		expect(f.installed.instances.values().next().value?.outgoing).toBeUndefined();
		expect(
			f.host
				.snapshot()
				.controls.find((control) => control.nodeId === f.nameId)
				?.writers.value?.("valid"),
		).toEqual({ status: "applied" });
		expect(await f.host.submit()).toEqual({ status: "submitted" });
		f.host.dispose();
	});

	it("retains composed constraints and nested array paths in JSON validation without inventing fields", () => {
		const schema = {
			...hostSchema,
			allOf: [
				{
					properties: {
						rows: {
							items: {
								properties: {
									nested: { items: { properties: { quantity: { minLength: 10 } } } },
								},
							},
						},
					},
				},
			],
		};
		expect(
			createJsonSchemaValidator(schema)({
				data: {
					profile: { name: "valid" },
					rows: [{ nested: [{ quantity: "short" }] }],
				},
				uiState: {},
			}),
		).toContainEqual(
			expect.objectContaining({
				code: "json-schema.minLength",
				path: expect.objectContaining({ segments: ["rows", 0, "nested", 0, "quantity"] }),
			}),
		);
	});

	it("retains extension provenance and blocks an independent extension error", async () => {
		const extension = vi.fn(() => [{ path: ["profile", "name"], source: "schema" as const, message: "reserved" }]);
		const f = validationHost(hostSchema, { validators: [extension] });
		expect(await f.host.submit()).toEqual({ status: "denied" });
		expect(extension).toHaveBeenCalled();
		expect(f.installed.instances.values().next().value?.issueRecords).toContainEqual(
			expect.objectContaining({ source: "extension", path: ["profile", "name"], message: "reserved" }),
		);
		expect(f.host.snapshot().lifecycle?.issues.extension).toContain("reserved");
		expect(f.installed.instances.values().next().value?.outgoing).toBeUndefined();
		f.host.dispose();
	});

	it("reports invalid dialect, remote references and hostile input without leaking accessor details", () => {
		for (const schema of [
			{ $schema: "http://json-schema.org/draft-07/schema#" },
			{ $ref: "https://remote.test/schema" },
			{ type: "invalid" },
		]) {
			const result = preflightJsonSchema(schema);
			expect(result).toMatchObject({ ok: false });
			expect(createJsonSchemaValidator(schema)({ data: {}, uiState: {} })[0]).toMatchObject({
				code: "json-schema.adapter-failure",
				path: { segments: [] },
			});
		}
		const hostile = Object.defineProperty({}, "type", {
			enumerable: true,
			get: () => {
				throw Error("secret");
			},
		});
		expect(preflightJsonSchema(hostile)).toMatchObject({ ok: false, error: expect.not.stringContaining("secret") });
	});

	it("bounds issue count and invalidates cached validators when schema content changes", () => {
		const schema = { type: "object", required: Array.from({ length: 150 }, (_, index) => `missing${index}`) };
		expect(createJsonSchemaValidator(schema)({ data: {}, uiState: {} })).toHaveLength(101);
		schema.required = ["new"];
		expect(createJsonSchemaValidator(schema)({ data: {}, uiState: {} })).toMatchObject([
			{ code: "json-schema.required", path: { segments: ["new"] } },
		]);
	});
});
