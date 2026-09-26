import { jsonSchemaProvider, standardSchemaProvider } from "@formbar/from-schema";
import { useForm } from "@formbar/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSchemaForm } from "../use-schema-form.js";

vi.mock("react", () => ({ useMemo: <T>(factory: () => T): T => factory() }));
vi.mock("@formbar/react", () => ({ useForm: vi.fn(() => ({ kind: "form" })) }));

describe("useSchemaForm preparation-only API", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns form, descriptors, validated definition, runtime baseline, diagnostics, and warnings", () => {
		const result = useSchemaForm(
			{ type: "object", properties: { name: { type: "string" } } },
			{
				provider: jsonSchemaProvider(),
				side: "input",
				initialData: { name: "Ada" },
			},
		);
		expect(Object.keys(result).sort()).toEqual([
			"baseline",
			"definition",
			"descriptors",
			"diagnostics",
			"form",
			"repeaterBaseline",
			"warnings",
		]);
		expect(result.definition.version).toBe(1);
		expect(result.baseline).toEqual([expect.objectContaining({ required: false })]);
		expect(vi.mocked(useForm).mock.calls[0]?.[0]).toMatchObject({ initialData: { name: "Ada" } });
	});

	it("leaves prepared JSON validators to the factory, not core options", () => {
		const validator = vi.fn(() => []);
		useSchemaForm({ type: "string" }, { provider: jsonSchemaProvider(), side: "input", validators: [validator] });
		const options = vi.mocked(useForm).mock.calls[0]?.[0];
		expect(options?.validators).toBeUndefined();
		expect(options).not.toHaveProperty("schema");
	});

	it("exposes option preparation warnings separately from validation issues", () => {
		const result = useSchemaForm(
			{
				type: "string",
				enum: ["a"],
				"x-formbar": {
					options: [
						{ value: "missing", title: "Missing" },
						{ value: "a", title: "Alpha" },
						{ value: "a", title: "Again" },
					],
				},
			},
			{ provider: jsonSchemaProvider(), side: "input" },
		);
		expect(result.diagnostics.compilation).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "unmatched-option", index: 0 }),
				expect.objectContaining({ code: "duplicate-option", index: 2 }),
			]),
		);
		expect(result.warnings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ channel: "compilation", code: "unmatched-option" }),
				expect.objectContaining({ channel: "compilation", code: "duplicate-option" }),
			]),
		);
		expect(vi.mocked(useForm).mock.calls[0]?.[0].validators).toBeUndefined();
	});

	it("installs the retained source validator through the executable validators path", () => {
		vi.mocked(useForm).mockImplementation((options, factory) => {
			const runtime = factory(options);
			runtime.activate();
			return runtime.form as never;
		});
		const schema = {
			"~standard": {
				version: 1 as const,
				vendor: "hook-test",
				validate: (value: unknown) =>
					typeof value === "string" ? { value } : { issues: [{ message: "Expected a string" }] },
			},
		};
		const result = useSchemaForm(schema, {
			provider: standardSchemaProvider(),
			side: "input",
			initialData: { invalid: true },
		});
		expect(result.form.validate()).toEqual([
			expect.objectContaining({ code: "SCHEMA_VALIDATION", message: "Expected a string" }),
		]);
		const options = vi.mocked(useForm).mock.calls[0]?.[0];
		expect(options?.validators?.[0]).toBe(schema);
		expect(options).not.toHaveProperty("schema");
	});

	it("automatically blocks plain JSON submission, composes caller validators and resets current data", async () => {
		vi.mocked(useForm).mockImplementation((options, factory) => {
			const runtime = factory(options);
			runtime.activate();
			return runtime.form as never;
		});
		const onSubmit = vi.fn(async () => ({ ok: true as const, submitId: "saved" }));
		const caller = vi.fn(() => []);
		const result = useSchemaForm(
			{ type: "object", required: ["name"] },
			{
				provider: jsonSchemaProvider(),
				side: "input",
				initialData: {},
				validators: [caller],
				onSubmit,
			},
		);
		expect(result.form.validate().map((issue) => issue.code)).toContain("json-schema.required");
		expect(await result.form.submit()).toMatchObject({ ok: false, reason: "validation-failed" });
		expect(caller).toHaveBeenCalled();
		expect(onSubmit).not.toHaveBeenCalled();
		result.form.setValue("name", "Ada");
		await result.form.submit();
		expect(onSubmit).toHaveBeenCalledTimes(1);
		result.form.reset();
		expect(result.form.validate().map((issue) => issue.code)).toContain("json-schema.required");
		result.form.dispose();
	});
});
