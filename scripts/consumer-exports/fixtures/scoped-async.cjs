const assert = require("node:assert/strict");
const { createElement } = require("react");
const { renderToString } = require("react-dom/server");
const { createSchemaForm, jsonSchemaProvider } = require("@formbar/from-schema");
const { useSchemaForm } = require("@formbar/react-schema");

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
async function main() {
	const immediate = prepared.createForm({ initialData: { "a.b": "x" } });
	assert.equal(Object.isFrozen(immediate.getState().data), true);
	const first = await immediate.validateAsync();
	assert.equal(first.status, "completed");
	assert.strictEqual(first.issues[0], immediate.getState().issues[0]);
	assert.deepEqual(first.issues[0].path.segments, ["a.b"]);
	const deferred = prepared.createDeferredForm({ initialData: { "a.b": "x" } });
	assert.equal(Object.isFrozen(deferred.form.getState().data), true);
	deferred.activate();
	const second = await deferred.form.validateAsync();
	assert.equal(second.status, "completed");
	assert.strictEqual(second.issues[0], deferred.form.getState().issues[0]);
	assert.notStrictEqual(second.issues[0], first.issues[0]);
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
	console.log("SCOPED_ASYNC same-format=cjs immediate+deferred+react=pass");
}
main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
