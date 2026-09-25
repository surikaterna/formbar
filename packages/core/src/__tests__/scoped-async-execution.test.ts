import { describe, expect, it } from "vitest";
import { createForm } from "../index.js";
import { issueEmissionId } from "../issue-provenance.js";
import { runScopedAsyncField } from "../scoped-async-execution.js";
import { FormStore } from "../store.js";
import { normalizeIssues } from "../validation.js";

describe("private scoped async emission", () => {
	it("mints only original issues with typed descendant data paths", async () => {
		const form = createForm({ initialData: { "0": [{ value: "ready" }] } });
		const controller = new AbortController();
		const issues = await runScopedAsyncField(
			{
				id: "async-one",
				fieldId: "field",
				instanceKey: "row-one",
				binding: { namespace: "data", segments: ["0", 0] },
				trigger: "onChange",
				debounceMs: 300,
				validate: async () => [{ code: "bad", message: "bad", severity: "error", descendant: ["value"] }],
			},
			{
				form,
				capture: form.captureState(),
				fields: [],
				projectionCurrent: () => true,
				revision: 1,
				currentRevision: () => 1,
				signal: controller.signal,
			},
		);
		const issue = issues[0];
		if (!issue) throw new Error("Expected scoped async issue");
		expect(issue.path.segments).toEqual(["0", 0, "value"]);
		expect(issueEmissionId(issue)).toBeDefined();
		expect(issueEmissionId({ ...issue })).toBeUndefined();
		controller.abort();
		expect(issueEmissionId(issue)).toBeUndefined();
	});

	it("preserves only the minted original through same-store metadata transactions in both orders", async () => {
		const form = createForm({ initialData: { name: "Ada" } });
		const [original] = await runScopedAsyncField(
			{
				id: "async-name",
				fieldId: "name",
				instanceKey: "name",
				binding: { namespace: "data", segments: ["name"] },
				trigger: "onChange",
				debounceMs: 0,
				validate: async () => [{ code: "bad", message: "bad", severity: "error" }],
			},
			{
				form,
				capture: form.captureState(),
				fields: [],
				projectionCurrent: () => true,
				revision: 1,
				currentRevision: () => 1,
				signal: new AbortController().signal,
			},
		);
		if (!original) throw new Error("Missing original issue");
		const copy = { ...original };
		for (const order of [
			[copy, original],
			[original, copy],
		]) {
			const store = new FormStore({ ...form.getState(), issues: order });
			const transaction = store.beginTransaction();
			transaction.mutate((draft) => ({ ...draft, meta: { ...draft.meta, stage: "next" } }));
			store.commitTransaction(transaction);
			const issues = store.getState().issues;
			expect(issues).toContain(original);
			expect(issues.filter((issue) => issueEmissionId(issue) !== undefined)).toEqual([original]);
			expect(normalizeIssues(issues)).toHaveLength(2);
			const copyTransaction = store.beginTransaction();
			copyTransaction.mutate((draft) => ({ ...draft, issues: draft.issues.map((issue) => ({ ...issue })) }));
			store.commitTransaction(copyTransaction);
			expect(store.getState().issues.every((issue) => issueEmissionId(issue) === undefined)).toBe(true);
		}
	});
});
