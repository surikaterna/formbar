import { createForm } from "@formbar/core";
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

	it("keeps source validation and caller validators independent", () => {
		const validator = vi.fn(() => []);
		useSchemaForm({ type: "string" }, { provider: jsonSchemaProvider(), side: "input", validators: [validator] });
		const options = vi.mocked(useForm).mock.calls[0]?.[0];
		expect(options?.validators).toEqual([validator]);
		expect(options).not.toHaveProperty("schema");
	});

	it("installs the retained source validator through the executable validators path", () => {
		vi.mocked(useForm).mockImplementation((options) => createForm(options) as never);
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
});
