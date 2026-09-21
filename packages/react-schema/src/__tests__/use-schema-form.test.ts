import { jsonSchemaProvider } from "@formbar/from-schema";
import { useForm } from "@formbar/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSchemaForm } from "../use-schema-form.js";

vi.mock("react", () => ({ useMemo: <T>(factory: () => T): T => factory() }));
vi.mock("@formbar/react", () => ({ useForm: vi.fn(() => ({ kind: "form" })) }));

describe("useSchemaForm preparation-only API", () => {
	beforeEach(() => vi.clearAllMocks());

	it("returns only form, descriptors, validated definition, diagnostics, and warnings", () => {
		const result = useSchemaForm(
			{ type: "object", properties: { name: { type: "string" } } },
			{
				provider: jsonSchemaProvider(),
				side: "input",
				initialData: { name: "Ada" },
			},
		);
		expect(Object.keys(result).sort()).toEqual(["definition", "descriptors", "diagnostics", "form", "warnings"]);
		expect(result.definition.version).toBe(1);
		expect(vi.mocked(useForm).mock.calls[0]?.[0]).toMatchObject({ initialData: { name: "Ada" } });
	});

	it("keeps source validation and caller validators independent", () => {
		const validator = vi.fn(() => []);
		useSchemaForm({ type: "string" }, { provider: jsonSchemaProvider(), side: "input", validators: [validator] });
		const options = vi.mocked(useForm).mock.calls[0]?.[0];
		expect(options?.validators).toEqual([validator]);
		expect(options).not.toHaveProperty("schema");
	});
});
