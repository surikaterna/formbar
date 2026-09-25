import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createForm, normalizeIssues } from "@formbar/core";
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
const data = { "a.b": Object.fromEntries([["0", "x"]]) };
const form = prepared.createForm({ initialData: data });
const [issue] = form.validate();
assert.deepEqual(issue.path.segments, ["a.b", "0"]);
assert.strictEqual(normalizeIssues([issue])[0], issue);
assert.equal(normalizeIssues([issue, { ...issue }]).length, 2);
const bare = createForm({ initialData: data, validators: [() => [{ ...issue }]] });
assert.equal(bare.validate().length, 1);
let deferred;
function Hook() {
	deferred = useSchemaForm({}, { ...options, initialData: data }).form;
	return null;
}
renderToString(createElement(Hook));
assert.deepEqual(deferred.validate()[0].path.segments, ["a.b", "0"]);
const require = createRequire(import.meta.url);
const cjs = require("@formbar/core");
assert.equal(cjs.normalizeIssues([issue, { ...issue }]).length, 1);
form.dispose();
deferred.dispose();
bare.dispose();
console.log("SCOPED_SYNC same-format=esm immediate+deferred=pass mixed-format=independent");
