import { createForm } from "@formbar/core";
import { describe, expect, it, vi } from "vitest";
import { baselineFixtures } from "../demos";
import { createJsonSchemaValidator, createJsonSchemaValidators } from "../validation/json-schema-validator";

function validate(schema: Readonly<Record<string, unknown>>, data: Record<string, unknown>) {
	return createJsonSchemaValidator(schema)({ data, uiState: {} });
}

const adapterFailure = {
	code: "json-schema.adapter-failure",
	message: "JSON Schema validation could not be completed.",
	severity: "error",
	path: { namespace: "data", segments: [] },
	source: {
		origin: "json-schema-adapter",
		validatorId: "json-schema-draft-2020-12",
		adapterId: "json-schema-adapter",
	},
} as const;

const unsupportedAsync = {
	...adapterFailure,
	code: "json-schema.unsupported-async",
	message: "Asynchronous JSON Schema validation is not supported.",
} as const;

describe("Draft 2020-12 JSON Schema adapter", () => {
	it("compiles every shared fixture source, including multi-source and Arbiter demos", () => {
		const sources = baselineFixtures.flatMap((fixture) => fixture.sources);
		expect(sources).toHaveLength(14);
		for (const source of sources) {
			expect(() => createJsonSchemaValidator(source.schema), source.key).not.toThrow();
		}
	});

	it("caches compilation by immutable schema identity without crossing schemas", () => {
		const first = { type: "object", required: ["first"] } as const;
		const second = { type: "object", required: ["second"] } as const;
		expect(createJsonSchemaValidator(first)).toBe(createJsonSchemaValidator(first));
		expect(createJsonSchemaValidator(first)).not.toBe(createJsonSchemaValidator(second));
		expect(createJsonSchemaValidators(first)).toBe(createJsonSchemaValidators(first));
		expect(createJsonSchemaValidators(first)).not.toBe(createJsonSchemaValidators(second));
		expect(validate(first, {})[0]?.path.segments).toEqual(["first"]);
		expect(validate(second, {})[0]?.path.segments).toEqual(["second"]);

		let reads = 0;
		const counted: Record<string, unknown> = {};
		Object.defineProperty(counted, "type", {
			enumerable: true,
			get() {
				reads += 1;
				return "object";
			},
		});
		const countedValidator = createJsonSchemaValidator(counted);
		const readsAfterCompile = reads;
		expect(readsAfterCompile).toBeGreaterThan(0);
		expect(createJsonSchemaValidator(counted)).toBe(countedValidator);
		expect(reads).toBe(readsAfterCompile);
	});

	it("requires own properties for inherited, unsafe, and escaped names without mutating data", () => {
		const names = ["~", "/", "__proto__", "constructor", "prototype", "a/b~c"];
		const schema = JSON.parse(JSON.stringify({ type: "object", required: names })) as Record<string, unknown>;
		const inherited = Object.fromEntries(names.map((name) => [name, "inherited"]));
		const data = Object.create(inherited) as Record<string, unknown>;
		const prototypeBefore = Object.getPrototypeOf(data);
		const descriptorsBefore = Object.getOwnPropertyDescriptors(data);
		const expectedPaths = [["/"], ["__proto__"], ["a/b~c"], ["constructor"], ["prototype"], ["~"]];

		expect(validate(schema, {}).map((issue) => issue.path.segments)).toEqual(expectedPaths);
		expect(validate(schema, data).map((issue) => issue.path.segments)).toEqual(expectedPaths);
		expect(Object.getPrototypeOf(data)).toBe(prototypeBefore);
		expect(Object.getOwnPropertyDescriptors(data)).toEqual(descriptorsBefore);

		const ownData = JSON.parse('{"~":"x","/":"x","__proto__":"x","constructor":"x","prototype":"x","a/b~c":"x"}');
		expect(validate(schema, ownData)).toEqual([]);
		expect(Object.hasOwn(ownData, "__proto__")).toBe(true);
	});

	it("produces canonical missing, nested array, and escaped-property paths in stable order", () => {
		const schema = {
			type: "object",
			required: ["profile", "a/b~c"],
			properties: {
				"a/b~c": { type: "string", minLength: 1 },
				profile: {
					type: "object",
					required: ["contacts"],
					properties: {
						contacts: {
							type: "array",
							items: {
								type: "object",
								properties: {
									address: {
										type: "object",
										required: ["street/name~primary"],
									},
								},
							},
						},
					},
				},
			},
		} as const;
		const data = { profile: { contacts: [{ address: {} }] } };
		const first = validate(schema, data);
		expect(first.map((issue) => issue.path)).toEqual([
			{ namespace: "data", segments: ["a/b~c"] },
			{ namespace: "data", segments: ["profile", "contacts", 0, "address", "street/name~primary"] },
		]);
		expect(validate(schema, data)).toEqual(first);
		expect(first.every((issue) => issue.severity === "error")).toBe(true);
		expect(first.every((issue) => issue.source.origin === "json-schema-adapter")).toBe(true);
	});

	it("types numeric pointer tokens from actual array versus object containers", () => {
		const schema = {
			type: "object",
			required: ["0"],
			properties: {
				"0": { type: "string", minLength: 1 },
				items: {
					type: "array",
					items: {
						type: "object",
						required: ["0"],
						properties: { "a/b~c": { type: "string", minLength: 1 } },
					},
				},
			},
		} as const;
		expect(validate(schema, { items: [{ "a/b~c": "" }] }).map((issue) => issue.path.segments)).toEqual([
			["0"],
			["items", 0, "0"],
			["items", 0, "a/b~c"],
		]);
		expect(validate(schema, { "0": "", items: [] })[0]?.path.segments).toEqual(["0"]);
	});

	it("distinguishes required property presence from a present non-empty string", () => {
		const schema = {
			type: "object",
			required: ["name"],
			properties: { name: { type: "string", minLength: 1 } },
		} as const;
		expect(validate(schema, {}).map((issue) => issue.code)).toEqual(["json-schema.required"]);
		expect(validate(schema, { name: "" }).map((issue) => issue.code)).toEqual(["json-schema.minLength"]);
		expect(validate(schema, { name: "Ada" })).toEqual([]);
	});

	it("asserts email format explicitly", () => {
		const schema = {
			type: "object",
			properties: { email: { type: "string", format: "email" } },
		} as const;
		expect(validate(schema, { email: "not-an-email" })).toMatchObject([
			{ code: "json-schema.format", message: 'Must match the "email" format.' },
		]);
		expect(validate(schema, { email: "person@example.com" })).toEqual([]);
	});

	it("normalizes enum, const, number bounds, and integer failures", () => {
		const schema = {
			type: "object",
			properties: {
				role: { enum: ["Admin", "User"] },
				mode: { const: "create" },
				score: { type: "number", minimum: 0 },
				ratio: { type: "number", maximum: 10 },
				count: { type: "integer" },
			},
		} as const;
		expect(validate(schema, { role: "Guest", mode: "edit", score: -1, ratio: 11, count: 1.5 })).toMatchObject([
			{ code: "json-schema.type", path: { segments: ["count"] } },
			{ code: "json-schema.const", path: { segments: ["mode"] } },
			{ code: "json-schema.maximum", path: { segments: ["ratio"] } },
			{ code: "json-schema.enum", path: { segments: ["role"] } },
			{ code: "json-schema.minimum", path: { segments: ["score"] } },
		]);
	});

	it("guards an if/then/else discriminator for absent, false, and true data", () => {
		const schema = {
			$schema: "https://json-schema.org/draft/2020-12/schema",
			type: "object",
			properties: {
				followUp: { type: "boolean" },
				email: { type: "string", format: "email" },
			},
			if: { required: ["followUp"], properties: { followUp: { const: true } } },
			// biome-ignore lint/suspicious/noThenProperty: This is the JSON Schema conditional keyword.
			then: { required: ["email"], properties: { email: { minLength: 1 } } },
			else: { properties: { followUp: { const: false } } },
		} as const;
		expect(validate(schema, {})).toEqual([]);
		expect(validate(schema, { followUp: false })).toEqual([]);
		expect(validate(schema, { followUp: true }).map((issue) => issue.code)).toContain("json-schema.required");
		expect(validate(schema, { followUp: true, email: "bad" }).map((issue) => issue.code)).toContain(
			"json-schema.format",
		);
		expect(validate(schema, { followUp: true, email: "person@example.com" })).toEqual([]);
	});

	it("fails closed for async schemas without a Promise or unhandled rejection", async () => {
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => unhandled.push(reason);
		process.on("unhandledRejection", onUnhandled);
		try {
			const schema = { $async: true, type: "object", required: ["name"] } as const;
			const validator = createJsonSchemaValidator(schema);
			expect(validator({ data: {}, uiState: {} })).toEqual([unsupportedAsync]);
			const compiledSignal = new Proxy(
				{ type: "object" },
				{
					get: (target, property, receiver) => (property === "$async" ? true : Reflect.get(target, property, receiver)),
				},
			);
			expect(validate(compiledSignal, {})).toEqual([unsupportedAsync]);
			const onSubmit = vi.fn(async () => ({ ok: true as const, submitId: "unexpected" }));
			const form = createForm({ initialData: {}, validators: [validator], onSubmit });
			await expect(form.submit()).resolves.toMatchObject({ ok: false, reason: "validation-failed" });
			expect(onSubmit).not.toHaveBeenCalled();
			form.dispose();
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(unhandled).toEqual([]);
		} finally {
			process.off("unhandledRejection", onUnhandled);
		}
	});

	it("caches deterministic failures for invalid, cyclic, and hostile schemas", () => {
		const invalid = { type: "not-a-json-schema-type" } as const;
		expect(validate(invalid, {})).toEqual([adapterFailure]);
		expect(createJsonSchemaValidator(invalid)).toBe(createJsonSchemaValidator(invalid));
		expect(createJsonSchemaValidators(invalid)).toBe(createJsonSchemaValidators(invalid));

		const cyclic: Record<string, unknown> = { type: "object" };
		cyclic.properties = { self: cyclic };
		expect(validate(cyclic, {})).toEqual([adapterFailure]);

		let reads = 0;
		const hostile: Record<string, unknown> = {};
		Object.defineProperty(hostile, "type", {
			configurable: true,
			get() {
				reads += 1;
				throw new Error("variable engine detail");
			},
		});
		expect(validate(hostile, {})).toEqual([adapterFailure]);
		expect(validate(hostile, {})).toEqual([adapterFailure]);
		expect(reads).toBe(1);

		const proxied = new Proxy(
			{},
			{
				ownKeys: () => {
					throw new Error("hostile proxy");
				},
			},
		);
		expect(validate(proxied, {})).toEqual([adapterFailure]);
	});

	it("isolates duplicate schema IDs and catches execution exceptions", () => {
		const first = { $id: "https://example.test/duplicate", type: "object", required: ["first"] } as const;
		const second = { $id: "https://example.test/duplicate", type: "object", required: ["second"] } as const;
		expect(validate(first, {})[0]?.path.segments).toEqual(["first"]);
		expect(validate(second, {})[0]?.path.segments).toEqual(["second"]);
		expect(validate(first, {})[0]?.path.segments).toEqual(["first"]);

		const validator = createJsonSchemaValidator({
			type: "object",
			required: ["name"],
			properties: { name: { type: "string" } },
		});
		const hostileData = new Proxy(
			{ name: "Ada" },
			{
				get: () => {
					throw new Error("hostile data");
				},
			},
		);
		expect(validator({ data: hostileData, uiState: {} })).toEqual([adapterFailure]);
	});
});
