import { jsonSchemaProvider, projectSchema } from "@formbar/from-schema";
import { describe, expect, test } from "vitest";
import {
	type TransformDefinition,
	createDateEgressTransform,
	createDateTransform,
	createForm,
	parsePath,
	runTransforms,
	sortIssues,
	toDot,
	toPointer,
} from "../index.js";

describe("F1-F10: Full integration conformance", () => {
	// --- (a) Simple contact form: F1, F6, F7 ---
	describe("(a) Simple contact form — F1 paths, F6 runtime, F7 API", () => {
		test("create form, set values via field API, read state", () => {
			const form = createForm({ initialData: {} });

			// F7: setValue API
			form.setValue("name", "Alice");
			form.setValue("email", "alice@example.com");
			form.setValue("phone", "555-1234");

			const state = form.getState();
			const data = state.data as Record<string, unknown>;
			expect(data.name).toBe("Alice");
			expect(data.email).toBe("alice@example.com");
			expect(data.phone).toBe("555-1234");

			// F1: path parsing round-trip
			const parsed = parsePath("name");
			expect(parsed.namespace).toBe("data");
			expect(toPointer(parsed)).toBe("/name");
			expect(toDot(parsed)).toBe("name");

			// F7: field API
			const nameField = form.field("name");
			expect(nameField.get()).toBe("Alice");

			form.dispose();
		});

		test("submit flow succeeds with onSubmit handler", async () => {
			let submittedPayload: unknown = null;
			const form = createForm({
				initialData: { name: "Bob" },
				onSubmit: async ({ payload }) => {
					submittedPayload = payload;
					return { ok: true, submitId: "test-submit" };
				},
			});

			const result = await form.submit();
			expect(result.ok).toBe(true);
			expect((submittedPayload as Record<string, unknown>).name).toBe("Bob");

			form.dispose();
		});
	});

	// --- (b) Schema-driven form with validation: F4, F5, F8 ---
	describe("(b) Schema-driven form — F4 ingestion, F5 validation envelope, F8 ordering", () => {
		test("project JSON schema descriptors and create a form", () => {
			const jsonSchema = {
				type: "object" as const,
				properties: {
					firstName: { type: "string" as const },
					lastName: { type: "string" as const },
					age: { type: "number" as const },
				},
				required: ["firstName", "lastName"],
			};

			const { descriptors } = projectSchema(jsonSchema, {
				provider: jsonSchemaProvider(),
				side: "input",
			});
			const properties = Object.values(descriptors.occurrences).filter((item) => item.relation === "property");
			expect(properties.map((item) => [item.key, item.presence])).toEqual([
				["firstName", "required"],
				["lastName", "required"],
				["age", "optional"],
			]);

			const initialData: Record<string, unknown> = Object.fromEntries(properties.map((item) => [item.key, undefined]));
			const form = createForm({ initialData });
			form.setValue("firstName", "Jane");
			form.setValue("lastName", "Doe");

			const data = form.getState().data as Record<string, unknown>;
			expect(data.firstName).toBe("Jane");

			form.dispose();
		});

		test("F5/F8: validation issue sorting by severity", () => {
			// sortIssues orders by severity: error > warning > info
			const source = { origin: "function-validator" as const, validatorId: "test" };
			const issues = [
				{ path: parsePath("b"), severity: "warning" as const, message: "warn", code: "W1", stage: "draft", source },
				{ path: parsePath("a"), severity: "error" as const, message: "err", code: "E1", stage: "draft", source },
				{ path: parsePath("c"), severity: "info" as const, message: "info", code: "I1", stage: "draft", source },
			];

			const sorted = sortIssues(issues, ["draft", "submit", "approve"]);
			expect(sorted[0]?.severity).toBe("error");
			expect(sorted[1]?.severity).toBe("warning");
			expect(sorted[2]?.severity).toBe("info");
		});
	});

	// --- (c) Expression-driven visibility via plugin ---
	describe("(c) Expression-driven visibility — plugin writes", () => {
		test("plugin applies writes to form state on setValue", () => {
			const form = createForm({
				initialData: { country: "US" },
				plugins: [
					{
						id: "visibility",
						evaluate: (ctx) => {
							const country = (ctx.data as Record<string, unknown>).country;
							if (country === "US") {
								return { writes: [{ path: "$ui.stateVisible", value: true, mode: "set" as const }] };
							}
							return { writes: [{ path: "$ui.stateVisible", value: undefined, mode: "delete" as const }] };
						},
					},
				],
			});

			// Trigger pipeline
			form.setValue("country", "US");
			expect((form.getState().uiState as Record<string, unknown>).stateVisible).toBe(true);

			form.dispose();
		});
	});

	// --- (d) Transform pipeline end-to-end: F9 ---
	describe("(d) Transform pipeline — F9 ingress/field/egress", () => {
		test("full transform pipeline with date fields", () => {
			const transforms: TransformDefinition[] = [
				{
					id: "ingress:parse-date",
					phase: "ingress",
					transform(value: unknown): unknown {
						if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
							return new Date(`${value}T00:00:00.000Z`);
						}
						return value;
					},
				},
				createDateTransform(),
				createDateEgressTransform(),
			];

			const ctx = { state: {} };

			// Ingress: "2025-06-15" → Date object
			const afterIngress = runTransforms(transforms, "ingress", "2025-06-15", ctx);
			expect(afterIngress).toBeInstanceOf(Date);

			// Field: Date → ISO string
			const afterField = runTransforms(transforms, "field", afterIngress, ctx);
			expect(afterField).toBe("2025-06-15T00:00:00.000Z");

			// Egress: ISO string passes through
			const afterEgress = runTransforms(transforms, "egress", afterField, ctx);
			expect(afterEgress).toBe("2025-06-15T00:00:00.000Z");

			// Store in form and verify
			const form = createForm({ initialData: {} });
			form.setValue("birthDate", afterField);
			const data = form.getState().data as Record<string, unknown>;
			expect(data.birthDate).toBe("2025-06-15T00:00:00.000Z");

			form.dispose();
		});
	});
});
