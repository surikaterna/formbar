import { afterEach, describe, expect, it, vi } from "vitest";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";

const definition = {
	version: 1 as const,
	id: "reorder",
	root: {
		type: "repeater" as const,
		id: "rows",
		scope: "row",
		binding: { namespace: "data", segments: ["rows"] },
		children: [
			{
				type: "field" as const,
				id: "value",
				widget: "text",
				binding: { namespace: "data", scope: "row", segments: ["value"] },
			},
		],
	},
};

function formFor(trigger: "onChange" | "onBlur") {
	return createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition,
			asyncFieldValidators: [
				{
					id: "scoped",
					fieldId: "value",
					trigger,
					debounceMs: 20,
					validate: async ({ data, field }) => [
						{
							code: `scoped:${(data as { rows: { value: string }[] }).rows[field.binding.segments[1] as number]?.value}`,
							message: "bad",
							severity: "error",
						},
					],
				},
			],
		},
	).createForm({
		initialData: { rows: [{ value: "a" }, { value: "b" }] },
		asyncValidators: [
			{
				id: "legacy",
				validate: async () => [
					{
						code: "scoped:a",
						message: "bad",
						severity: "error" as const,
						path: { namespace: "data" as const, segments: ["rows", 0, "value"] },
						source: { origin: "async-validator" as const, validatorId: "legacy" },
					},
				],
			},
		],
	});
}

afterEach(() => vi.useRealTimers());

describe("completed scoped issue ownership on recycled indices", () => {
	it.each(["onBlur", "onChange"] as const)(
		"invalidates completed foreground %s rows without restarting blur",
		async (trigger) => {
			vi.useFakeTimers();
			const form = formFor(trigger);
			try {
				const first = await form.validateAsync();
				expect(first.status).toBe("completed");
				const originals = first.issues.filter((issue) => issue.source.validatorId === "scoped");
				expect(originals.map((issue) => issue.code)).toEqual(["scoped:a", "scoped:b"]);
				form.setValue("rows", [{ value: "b" }, { value: "a" }]);
				const immediate = form.getState().issues;
				for (const original of originals) expect(immediate).not.toContain(original);
				expect(immediate.map((issue) => issue.source.validatorId)).toEqual(["legacy"]);
				await vi.advanceTimersByTimeAsync(20);
				expect(form.getState().issues.map((issue) => issue.source.validatorId)).toEqual(
					trigger === "onBlur" ? ["legacy"] : ["legacy", "scoped", "scoped"],
				);
			} finally {
				form.dispose();
			}
		},
	);

	it("invalidates completed automatic rows on reuse before debounce and preserves legacy", async () => {
		vi.useFakeTimers();
		const form = formFor("onChange");
		try {
			form.setValue("rows", [{ value: "a" }, { value: "b" }]);
			await vi.advanceTimersByTimeAsync(20);
			const originals = form.getState().issues.filter((issue) => issue.source.validatorId === "scoped");
			expect(originals).toHaveLength(2);
			form.setValue("rows", [{ value: "b" }, { value: "a" }]);
			for (const original of originals) expect(form.getState().issues).not.toContain(original);
			expect(form.getState().issues.map((issue) => issue.code)).toEqual([]);
			await vi.advanceTimersByTimeAsync(20);
			expect(form.getState().issues.map((issue) => issue.code)).toEqual(["scoped:b", "scoped:a"]);
		} finally {
			form.dispose();
		}
	});

	it("fails closed on indistinguishable structural array replacement without claiming row IDs", async () => {
		const form = formFor("onBlur");
		try {
			const first = await form.validateAsync();
			const originals = first.issues.filter((issue) => issue.source.validatorId === "scoped");
			form.setValue("rows", [{ value: "a" }, { value: "b" }]);
			for (const original of originals) expect(form.getState().issues).not.toContain(original);
			expect(form.getState().issues.map((issue) => issue.source.validatorId)).toEqual(["legacy"]);
		} finally {
			form.dispose();
		}
	});
});
