import { useForm, useFormSelector } from "@formbar/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSchemaForm } from "../use-schema-form.js";

vi.mock("react", () => ({
	useMemo: <T>(factory: () => T): T => factory(),
}));

vi.mock("@formbar/react", () => ({
	useForm: vi.fn(),
	useFormSelector: vi.fn((_form, selector) => selector({ uiState: currentUiState })),
}));

let currentUiState: Readonly<Record<string, unknown>> | null | undefined = {};

const schemaWithoutDefaults = {
	type: "object",
	properties: {
		name: { type: "string" },
	},
};

const schemaWithDefaults = {
	type: "object",
	properties: {
		name: { type: "string", default: "schema name" },
		role: { type: "string", default: "viewer" },
	},
};

interface FormData {
	readonly name?: string;
	readonly role?: string;
}

describe("useSchemaForm initial data", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		currentUiState = {};
	});

	it("omits initialData when neither the schema nor caller supplies it", () => {
		useSchemaForm<FormData, Record<string, unknown>>(schemaWithoutDefaults);

		expect(useForm).toHaveBeenCalledOnce();
		expect(vi.mocked(useForm).mock.calls[0]?.[0]).not.toHaveProperty("initialData");
	});

	it("passes caller initialData when the schema has no defaults", () => {
		const initialData = { name: "caller name" };

		useSchemaForm<FormData, Record<string, unknown>>(schemaWithoutDefaults, { initialData });

		expect(vi.mocked(useForm).mock.calls[0]?.[0]).toHaveProperty("initialData", initialData);
	});

	it("fills missing caller data from schema defaults while preserving caller precedence", () => {
		useSchemaForm<FormData, Record<string, unknown>>(schemaWithDefaults, {
			initialData: { name: "caller name" },
		});

		expect(vi.mocked(useForm).mock.calls[0]?.[0]).toHaveProperty("initialData", {
			name: "caller name",
			role: "viewer",
		});
	});
});

describe("useSchemaForm presentation compatibility", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		currentUiState = {};
	});

	it("subscribes to dynamic UI state and returns a non-null pruned root", () => {
		currentUiState = { "name.visible": false, "name.readOnly": "yes", "name.disabled": 0 };
		const result = useSchemaForm<FormData, Record<string, unknown>>(schemaWithoutDefaults);

		expect(useFormSelector).toHaveBeenCalledOnce();
		expect(result.fieldStates.get("name")).toEqual({ visible: false, readOnly: true, disabled: false });
		expect(result.layout).not.toBeNull();
		expect(result.layout.children).toEqual([]);
	});

	it("falls back to an empty UI state when the form state has no object", () => {
		currentUiState = null;
		const result = useSchemaForm<FormData, Record<string, unknown>>(schemaWithoutDefaults);

		expect(result.fieldStates.get("name")).toBeDefined();
		expect(result.fieldStates.get("name")?.visible).toBe(true);
	});
});

describe("useSchemaForm option warnings", () => {
	it("surfaces preparation warnings and resolved titles", () => {
		vi.clearAllMocks();
		const resolveOptionTitle = vi.fn(({ value }: { value: unknown }) =>
			value === "active" ? "Resolved active" : undefined,
		);
		const result = useSchemaForm<FormData, Record<string, unknown>>(
			{
				type: "object",
				properties: {
					role: {
						type: "string",
						enum: ["active"],
						"x-formbar": { options: [{ value: "missing", title: "Missing" }] },
					},
				},
			},
			{ resolveOptionTitle },
		);

		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toMatchObject({
			code: "FORMBAR_OPTION_UNMATCHED",
			path: "role",
			index: 0,
			value: "missing",
		});
		expect(result.optionsByPath.get("role")).toEqual([{ value: "active", title: "Resolved active" }]);
		expect(vi.mocked(useForm).mock.calls[0]?.[0]).not.toHaveProperty("resolveOptionTitle");
	});

	it("surfaces primitive array item preparation warnings once", () => {
		const result = useSchemaForm<FormData, Record<string, unknown>>({
			type: "object",
			properties: {
				tags: {
					type: "array",
					items: {
						type: "string",
						enum: ["kept"],
						"x-formbar": {
							options: [
								{ value: "missing", title: "Missing" },
								{ value: "kept", title: "Kept" },
								{ value: "kept", title: "Duplicate" },
							],
						},
					},
				},
			},
		});

		expect(result.optionsByPath.get("tags[]")).toEqual([{ value: "kept", title: "Kept" }]);
		expect(result.warnings.map(({ code, path, index }) => ({ code, path, index }))).toEqual([
			{ code: "FORMBAR_OPTION_UNMATCHED", path: "tags[]", index: 0 },
			{ code: "FORMBAR_OPTION_DUPLICATE", path: "tags[]", index: 2 },
		]);
	});
});
