import { expect, test } from "vitest";
import { createForm } from "../create-form.js";
import { issueEmissionId } from "../issue-provenance.js";
import { runScopedAsyncField } from "../scoped-async-execution.js";
import { scopedCaptureReceipt } from "../scoped-capture-receipt.js";
import { normalizeIssues } from "../validation.js";

test("owned async mint keeps only its original certified across normalization and metadata writes", async () => {
	const form = createForm({ initialData: { "a.b": [{ "0": "ready" }] }, ownedScheduling: true });
	const capture = form.captureState();
	const controller = new AbortController();
	const [original] = await runScopedAsyncField(
		{
			id: "unique",
			fieldId: "leaf",
			instanceKey: "row:0",
			binding: { namespace: "data", segments: ["a.b", 0, "0"] },
			trigger: "onBlur",
			debounceMs: 0,
			validate: async () => [{ code: "bad", message: "bad", severity: "error" }],
		},
		{
			form,
			capture,
			receipt: scopedCaptureReceipt(capture),
			revision: 1,
			currentRevision: () => 1,
			projectionCurrent: () => true,
			signal: controller.signal,
		},
	);
	if (!original) throw new Error("Missing issue");
	expect(original.path.segments).toEqual(["a.b", 0, "0"]);
	expect(original.source).toEqual({ origin: "async-validator", validatorId: "unique" });
	expect(normalizeIssues([original, { ...original }])).toContain(original);
	expect(issueEmissionId(original)).toBeDefined();
	expect(issueEmissionId({ ...original })).toBeUndefined();
	controller.abort();
	expect(issueEmissionId(original)).toBeUndefined();
	form.dispose();
});
