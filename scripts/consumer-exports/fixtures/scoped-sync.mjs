import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createForm, normalizeIssues } from "@formbar/core";
import * as core from "@formbar/core";
import { registerScopedSync } from "@formbar/core/internal/scoped-sync";
import * as declarative from "@formbar/declarative";
import { createSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";
import { useSchemaForm } from "@formbar/react-schema";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

const definition = {
	version: 1,
	id: "prepared",
	root: { type: "field", id: "field", widget: "text", binding: { namespace: "data", segments: ["a.b", "0"] } },
};
const fieldValidators = [{ fieldId: "field", validate: () => [{ code: "owned", message: "bad", severity: "error" }] }];
const options = { provider: jsonSchemaProvider(), side: "input", definition, fieldValidators };
const prepared = createSchemaForm({}, options);
assert.equal(core.registerScopedSync, undefined);
assert.equal(declarative.prepareScopedSyncHost, undefined);
assert.equal(typeof registerScopedSync, "function"); // Importable trusted adapter, not a JS sandbox.
const data = { "a.b": Object.fromEntries([["0", "x"]]) };
const form = prepared.createForm({ initialData: data });
const [issue] = form.validate();
assert.deepEqual(issue.path.segments, ["a.b", "0"]);
assert.strictEqual(normalizeIssues([issue])[0], issue);
assert.equal(normalizeIssues([issue, { ...issue }]).length, 2);
const bare = createForm({ initialData: data, validators: [() => [{ ...issue }]] });
assert.equal(bare.validate().length, 1);
assert.equal(normalizeIssues([issue, bare.validate()[0]]).length, 2);
assert.equal(
	normalizeIssues([issue, { ...issue, path: { ...issue.path, segments: [...issue.path.segments] } }]).length,
	2,
);
let deferred;
function Hook() {
	deferred = useSchemaForm({}, { ...options, initialData: data }).form;
	return null;
}
renderToString(createElement(Hook));
const [deferredIssue] = deferred.validate();
assert.deepEqual(deferredIssue.path.segments, ["a.b", "0"]);
assert.strictEqual(normalizeIssues([deferredIssue])[0], deferredIssue);
assert.equal(normalizeIssues([deferredIssue, { ...deferredIssue }]).length, 2);
const require = createRequire(import.meta.url);
const cjs = require("@formbar/core");
assert.equal(cjs.normalizeIssues([issue, { ...issue }]).length, 1);
form.dispose();
deferred.dispose();
bare.dispose();
const asyncOptions = {
	provider: jsonSchemaProvider(),
	side: "input",
	definition,
	asyncFieldValidators: [
		{
			id: "async-field",
			fieldId: "field",
			validate: async () => [{ code: "async-owned", message: "bad", severity: "error" }],
		},
	],
};
const asyncForm = createSchemaForm({}, asyncOptions).createForm({ initialData: data });
const [asyncIssue] = (await asyncForm.validateAsync()).issues;
assert.deepEqual(asyncIssue.path.segments, ["a.b", "0"]);
assert.strictEqual(asyncForm.getState().issues[0], asyncIssue);
assert.equal(normalizeIssues([asyncIssue, { ...asyncIssue }]).length, 2);
let deferredAsync;
function AsyncHook() {
	deferredAsync = useSchemaForm({}, { ...asyncOptions, initialData: data }).form;
	return null;
}
renderToString(createElement(AsyncHook));
assert.deepEqual(
	(await deferredAsync.validateAsync()).issues.map((entry) => entry.code),
	["async-owned"],
);
assert.equal(core.registerScopedAsync, undefined);
asyncForm.dispose();
deferredAsync.dispose();
console.log("SCOPED_SYNC same-format=esm immediate+deferred=pass mixed-format=independent");
