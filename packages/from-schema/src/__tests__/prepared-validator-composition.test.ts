import { expect, test, vi } from "vitest";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";

const schema = { type: "object", required: ["name"], properties: { name: { type: "string" } } };

test.each(["authored", "generated"] as const)("%s prepared eager/deferred validators compose once", async (mode) => {
	const config = { provider: jsonSchemaProvider(), side: "input" as const };
	const definition = {
		version: 1 as const,
		id: "authored",
		root: {
			type: "field" as const,
			id: "name-field",
			widget: "text",
			binding: { namespace: "data", segments: ["name"] },
		},
	};
	const preparation = mode === "authored" ? { definition } : { generation: {} };
	const initial = createSchemaForm(schema, { ...config, ...preparation });
	const fieldId =
		mode === "authored"
			? "name-field"
			: initial.definition.root.type === "group"
				? initial.definition.root.children[0]?.id
				: undefined;
	if (!fieldId) throw new Error("Missing generated field");
	const seen: string[] = [];
	const issue = (code: string) => [
		{
			code,
			message: code,
			severity: "error" as const,
			path: { namespace: "data" as const, segments: ["name"] },
			source: { origin: "rule" as const, validatorId: code },
		},
	];
	const caller = vi.fn((input: unknown) => {
		expect(input).toMatchObject({ data: { name: "ok" }, uiState: { tab: 1 }, stage: "review" });
		seen.push("caller");
		return issue("caller");
	});
	const core = vi.fn((input: unknown) => {
		expect(input).toMatchObject({ data: { name: "ok" }, uiState: { tab: 1 }, stage: "review" });
		seen.push("core");
		return issue("core");
	});
	const scoped = vi.fn((input: unknown) => {
		expect(input).toMatchObject({ data: { name: "ok" }, uiState: { tab: 1 }, stage: "review" });
		seen.push("scoped");
		return [{ code: "scoped", message: "scoped", severity: "error" as const }];
	});
	const legacyAsync = vi.fn(async (input: unknown) => {
		expect(input).toMatchObject({ data: { name: "ok" }, uiState: { tab: 1 } });
		return issue("legacy-async");
	});
	const scopedAsync = vi.fn(async (input: unknown) => {
		expect(input).toMatchObject({ data: { name: "ok" }, uiState: { tab: 1 } });
		return [{ code: "scoped-async", message: "scoped-async", severity: "error" as const }];
	});
	const prepared = createSchemaForm(schema, {
		...config,
		...preparation,
		validators: [caller],
		fieldValidators: [{ fieldId, validate: scoped }],
		asyncFieldValidators: [{ id: "scoped-async", fieldId, validate: scopedAsync }],
	});
	const options = {
		initialData: { name: "ok" },
		initialUiState: { tab: 1 },
		validators: [core],
		asyncValidators: [{ id: "legacy-async", validate: legacyAsync }],
	};
	for (const deferred of [false, true]) {
		const runtime = deferred ? prepared.createDeferredForm(options) : undefined;
		const form = runtime?.form ?? prepared.createForm(options);
		runtime?.activate();
		try {
			seen.length = 0;
			expect(form.validate("review").map((entry) => entry.code)).toEqual(["caller", "core", "scoped"]);
			expect(seen).toEqual(["caller", "core", "scoped"]);
			expect((await form.validateAsync()).issues.map((entry) => entry.code)).toEqual(["legacy-async", "scoped-async"]);
			for (const fn of [caller, core, scoped, legacyAsync, scopedAsync]) expect(fn).toHaveBeenCalled();
		} finally {
			form.dispose();
		}
	}
	expect(() => prepared.createForm({ ...options, validators: prepared.validators })).toThrow("only once");
	expect(() => prepared.createDeferredForm({ ...options, validators: [caller] })).toThrow("only once");
	const required = initial.createForm({ initialData: {} });
	expect(required.validate().map((entry) => entry.code)).toContain("json-schema.required");
	required.dispose();
});
