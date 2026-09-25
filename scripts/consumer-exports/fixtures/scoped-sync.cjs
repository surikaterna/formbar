const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToString } = require("react-dom/server");
const { createForm, normalizeIssues } = require("@formbar/core");
const core = require("@formbar/core");
const declarative = require("@formbar/declarative");
const { activateOwnedSchedulingBoundary, registerScopedSync } = require("@formbar/core/internal/scoped-sync");
const { createSchemaForm, jsonSchemaProvider } = require("@formbar/from-schema");
const { useSchemaForm } = require("@formbar/react-schema");

const definition = {
	version: 1,
	id: "prepared",
	root: { type: "field", id: "field", widget: "text", binding: { namespace: "data", segments: ["a.b", "0"] } },
};
const fieldValidators = [{ fieldId: "field", validate: () => [{ code: "owned", message: "bad", severity: "error" }] }];
const options = { provider: jsonSchemaProvider(), side: "input", definition, fieldValidators };
const prepared = createSchemaForm({}, options);
const initCalls = [];
const ownedOptions = {
	initialData: { "a.b": { 0: "x" } },
	ownedScheduling: true,
	plugins: [
		{
			id: "owned-init",
			onInit: ({ getState, initialData }) =>
				initCalls.push(Object.isFrozen(getState().data) && Object.isFrozen(initialData)),
		},
	],
};
const eagerOwned = prepared.createForm(ownedOptions);
assert.deepEqual(initCalls, [true]);
const deferredOwned = prepared.createDeferredForm(ownedOptions);
assert.equal(Object.isFrozen(deferredOwned.form.getState().data), true);
deferredOwned.activate();
assert.deepEqual(initCalls, [true, true]);
assert.throws(() => prepared.createForm({ ...ownedOptions, initialData: { bad: new Date() } }), {
	message: "ISSUE_ONLY_UNSUPPORTED_STATE",
});
assert.deepEqual(initCalls, [true, true]);
eagerOwned.dispose();
deferredOwned.form.dispose();
assert.equal(core.registerScopedSync, undefined);
assert.equal(declarative.prepareScopedSyncHost, undefined);
assert.equal(typeof registerScopedSync, "function"); // Importable trusted adapter, not a JS sandbox.
const data = { "a.b": Object.fromEntries([["0", "x"]]) };
const form = prepared.createForm({ initialData: data });
const prior = form.getState();
activateOwnedSchedulingBoundary(form);
const owned = form.getState();
assert.notStrictEqual(owned.data, prior.data);
assert.equal(Object.isFrozen(owned.data), true);
prior.data["a.b"]["0"] = "old alias";
assert.equal(owned.data["a.b"]["0"], "x");
const [issue] = form.validate();
assert.deepEqual(issue.path.segments, ["a.b", "0"]);
assert.strictEqual(normalizeIssues([issue])[0], issue);
assert.equal(normalizeIssues([issue, { ...issue }]).length, 2);
const plain = {
	...issue,
	path: { ...issue.path, segments: [...issue.path.segments] },
	details: { nested: { value: 1 } },
};
const bare = createForm({ initialData: data, validators: [() => [plain]] });
assert.equal(Object.isFrozen(bare.getState().data), false);
assert.strictEqual(bare.validate()[0], plain);
bare.setValue("new", 1);
const [detached] = bare.getState().issues;
assert.notStrictEqual(detached, plain);
assert.strictEqual(normalizeIssues([plain])[0], plain);
assert.equal(Object.isFrozen(detached.details.nested), true);
plain.details.nested.value = 2;
assert.equal(detached.details.nested.value, 1);
assert.equal(bare.validate().length, 1);
assert.equal(normalizeIssues([issue, bare.validate()[0]]).length, 2);
assert.equal(
	normalizeIssues([issue, { ...issue, path: { ...issue.path, segments: [...issue.path.segments] } }]).length,
	2,
);
let deferred;
const deferredRuntime = prepared.createDeferredForm({ initialData: data });
activateOwnedSchedulingBoundary(deferredRuntime.form);
assert.equal(Object.isFrozen(deferredRuntime.form.getState().data), true);
deferredRuntime.activate();
assert.equal(deferredRuntime.form.validate().length, 1);
function Hook() {
	deferred = useSchemaForm({}, { ...options, initialData: data }).form;
	return null;
}
renderToString(createElement(Hook));
function OwnedHook() {
	const first = useSchemaForm({}, { ...options, initialData: data, ownedScheduling: true }).form;
	assert.equal(Object.isFrozen(first.getState().data), true);
	return null;
}
renderToString(createElement(OwnedHook));
const [deferredIssue] = deferred.validate();
assert.deepEqual(deferredIssue.path.segments, ["a.b", "0"]);
assert.strictEqual(normalizeIssues([deferredIssue])[0], deferredIssue);
assert.equal(normalizeIssues([deferredIssue, { ...deferredIssue }]).length, 2);
form.dispose();
deferredRuntime.form.dispose();
deferred.dispose();
bare.dispose();
console.log("SCOPED_SYNC same-format=cjs immediate+deferred=pass");
