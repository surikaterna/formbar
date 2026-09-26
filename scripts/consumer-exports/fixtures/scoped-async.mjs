import assert from "node:assert/strict";
import { issueEmissionId, runScopedCandidate } from "@formbar/core/internal/scoped-sync";
import { normalizeIssues } from "@formbar/core/validation";
import { createSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";
import { useSchemaForm } from "@formbar/react-schema";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const definition = {
	version: 1,
	id: "prepared",
	root: { type: "field", id: "leaf", widget: "text", binding: { namespace: "data", segments: ["a.b"] } },
};
const asyncFieldValidators = [
	{
		id: "scoped",
		fieldId: "leaf",
		debounceMs: 0,
		validate: async () => [{ code: "BAD", message: "bad", severity: "error" }],
	},
];
const options = { provider: jsonSchemaProvider(), side: "input", definition, asyncFieldValidators };
const prepared = createSchemaForm({}, options);
const immediate = prepared.createForm({ initialData: { "a.b": "x" } });
assert.equal(Object.isFrozen(immediate.getState().data), true);
const first = await immediate.validateAsync();
assert.equal(first.status, "completed");
assert.strictEqual(first.issues[0], immediate.getState().issues[0]);
assert.deepEqual(first.issues[0].path.segments, ["a.b"]);
const final = await runScopedCandidate(
	immediate,
	{ data: Object.freeze({ "a.b": "final" }), uiState: immediate.getState().uiState },
	undefined,
	{ requestId: "final", at: "now" },
	new AbortController().signal,
	0,
	() => 0,
);
assert.equal(typeof issueEmissionId(final[0]), "number");
assert.strictEqual(normalizeIssues(final)[0], final[0]);
assert.strictEqual(immediate.getState().issues[0], first.issues[0]);
const deferred = prepared.createDeferredForm({ initialData: { "a.b": "x" } });
assert.equal(Object.isFrozen(deferred.form.getState().data), true);
deferred.activate();
const second = await deferred.form.validateAsync();
assert.equal(second.status, "completed");
assert.strictEqual(second.issues[0], deferred.form.getState().issues[0]);
assert.notStrictEqual(second.issues[0], first.issues[0]);
const deferredFinal = await runScopedCandidate(
	deferred.form,
	{ data: Object.freeze({ "a.b": "final" }), uiState: deferred.form.getState().uiState },
	undefined,
	undefined,
	new AbortController().signal,
	0,
	() => 0,
);
assert.equal(typeof issueEmissionId(deferredFinal[0]), "number");
assert.notStrictEqual(deferredFinal[0], final[0]);
assert.throws(
	() => prepared.createForm({ asyncValidators: [{ id: "scoped", validate: async () => [] }] }),
	/Duplicate/,
);
function Hook() {
	const hook = useSchemaForm({}, { ...options, initialData: { "a.b": "x" } });
	assert.equal(Object.isFrozen(hook.form.getState().data), true);
	return null;
}
renderToString(createElement(Hook));
immediate.dispose();
deferred.form.dispose();
console.log("SCOPED_ASYNC same-format=esm immediate+deferred+react=pass");
