import { createForm } from "@formbar/core";
import { describe, expect, it, vi } from "vitest";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";

const provider = jsonSchemaProvider();
const prepare = (schema: unknown, validators: readonly (() => readonly never[])[] = []) =>
	createSchemaForm<Record<string, unknown>, Record<string, unknown>>(schema, { provider, side: "input", validators });

describe("automatic plain JSON Schema validation", () => {
	it("blocks missing, wrong type, enum, const, nested arrays, refs and format errors before caller validators", async () => {
		const schema = {
			type: "object",
			required: ["name"],
			$defs: { item: { type: "integer", minimum: 1 } },
			properties: {
				name: { type: "string", minLength: 2 },
				role: { enum: ["admin"] },
				mode: { const: "edit" },
				email: { type: "string", format: "email" },
				items: { type: "array", items: { $ref: "#/$defs/item" } },
			},
		};
		const caller = vi.fn(() => [] as const);
		const onSubmit = vi.fn(async () => ({ ok: true as const, submitId: "saved" }));
		const prepared = prepare(schema, [caller]);
		expect(prepared.validators).toHaveLength(2);
		const form = createForm({ initialData: {}, validators: prepared.validators, onSubmit });
		expect(form.validate().map((issue) => issue.path.segments)).toContainEqual(["name"]);
		expect(await form.submit()).toMatchObject({ ok: false, reason: "validation-failed" });
		expect(onSubmit).not.toHaveBeenCalled();
		form.setValue("name", "Ada");
		form.setValue("role", "guest");
		form.setValue("mode", "create");
		form.setValue("email", "bad");
		form.setValue("items", [0, "no"]);
		expect(form.validate().map((issue) => issue.code)).toEqual(
			expect.arrayContaining([
				"json-schema.enum",
				"json-schema.const",
				"json-schema.format",
				"json-schema.minimum",
				"json-schema.type",
			]),
		);
		expect(form.validate().map((issue) => issue.path.segments)).toContainEqual(["items", 1]);
		form.setValue("role", "admin");
		form.setValue("mode", "edit");
		form.setValue("email", "a@example.com");
		form.setValue("items", [1]);
		expect(form.validate()).toEqual([]);
		await form.submit();
		expect(onSubmit).toHaveBeenCalledTimes(1);
		form.setValue("name", "");
		await form.submit();
		expect(onSubmit).toHaveBeenCalledTimes(1);
		form.dispose();
	});

	it("reports invalid dialect, format, remote ref and hostile schema on the validation channel and blocks submit", async () => {
		for (const schema of [
			{ $schema: "http://json-schema.org/draft-07/schema#" },
			{ type: "string", format: "unknown" },
			{ $ref: "https://remote.test/schema" },
			{ type: "invalid" },
			{ type: "object", $vocabulary: {} },
		]) {
			const prepared = prepare(schema);
			expect(prepared.diagnostics.validation[0]).toMatchObject({ severity: "error" });
			const form = createForm({ initialData: {}, validators: prepared.validators, onSubmit: vi.fn() });
			expect(form.validate()[0]).toMatchObject({ code: "json-schema.adapter-failure", path: { segments: [] } });
			expect(await form.submit()).toMatchObject({ ok: false, reason: "validation-failed" });
			form.dispose();
		}
		const hostile = Object.defineProperty({}, "type", {
			enumerable: true,
			get: () => {
				throw Error("secret");
			},
		});
		expect(prepare(hostile).diagnostics.validation[0]?.message).not.toContain("secret");
	});

	it("does not turn presentation options into validation rules and checks hidden stored values", () => {
		const prepared = prepare({
			type: "object",
			properties: {
				hidden: {
					type: "string",
					enum: ["a"],
					"x-formbar": { options: [{ value: "b", title: "B", disabled: false }] },
				},
			},
		});
		const form = createForm({ initialData: { hidden: "b" }, validators: prepared.validators });
		expect(form.validate().map((issue) => issue.code)).toContain("json-schema.enum");
		form.dispose();
	});

	it("bounds reported errors and detects mutation before reusing a cached validator", () => {
		const schema = { type: "object", required: Array.from({ length: 150 }, (_, index) => `missing${index}`) };
		const original = prepare(schema);
		expect(original.validators[0]?.({ data: {}, uiState: {} })).toHaveLength(101);
		expect(original.validators[0]?.({ data: {}, uiState: {} })).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "json-schema.truncated", path: { namespace: "data", segments: [] } }),
			]),
		);
		schema.required = ["new"];
		expect(prepare(schema).validators[0]?.({ data: {}, uiState: {} })).toMatchObject([
			{ code: "json-schema.required", path: { segments: ["new"] } },
		]);
	});

	it("rejects unsupported provider dialect, oversized, cyclic and accessor schemas without calling caller validators", () => {
		const imitation = { ...jsonSchemaProvider(), name: "json-schema" };
		expect(createSchemaForm({ type: "object" }, { provider: imitation, side: "input" }).validators).toEqual([]);
		const unsupported = createSchemaForm(
			{ type: "object" },
			{
				provider: jsonSchemaProvider({ dialect: "draft-07" }),
				side: "input",
			},
		);
		expect(unsupported.diagnostics.validation[0]?.code).toBe("unsupported-dialect");
		const tooLarge = prepare({ type: "string", description: "a".repeat(262145) });
		expect(tooLarge.diagnostics.validation[0]?.code).toBe("schema-limit");
		const cyclic: Record<string, unknown> = { type: "object" };
		cyclic.properties = { self: cyclic };
		expect(prepare(cyclic).diagnostics.validation[0]?.code).toBe("non-json-schema");
		const accessor = Object.defineProperty({}, "type", {
			enumerable: true,
			get: () => {
				throw Error("untrusted");
			},
		});
		expect(prepare(accessor).validators[0]?.({ data: {}, uiState: {} })).toMatchObject([
			{ code: "json-schema.adapter-failure" },
		]);
	});

	it("uses Ajv composed validation and local anchors without inferring composed presentation", () => {
		const schema = {
			type: "object",
			$defs: { named: { $anchor: "named", type: "string", minLength: 2 } },
			allOf: [{ required: ["name"] }, { properties: { name: { $ref: "#named" } } }],
			if: { required: ["special"] },
			then: { required: ["code"] },
		};
		const prepared = prepare(schema);
		expect(prepared.diagnostics.validation).toEqual([]);
		expect(
			prepared.validators[0]?.({ data: { name: "x", special: true }, uiState: {} }).map((issue) => issue.code),
		).toEqual(expect.arrayContaining(["json-schema.minLength", "json-schema.required"]));
		expect(prepared.validators[0]?.({ data: { name: "Ada" }, uiState: {} })).toEqual([]);
	});
});
