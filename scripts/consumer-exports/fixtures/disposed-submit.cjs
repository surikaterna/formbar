const assert = require("node:assert/strict");

module.exports = async function run(createSchemaForm, jsonSchemaProvider) {
	let release;
	const waiting = new Promise((resolve) => {
		release = resolve;
	});
	let calls = 0;
	const form = createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition: {
				version: 1,
				id: "disposed-submit",
				submission: { hiddenValues: "omit-inactive" },
				root: {
					type: "group",
					id: "root",
					children: [
						{
							type: "field",
							id: "secret",
							widget: "text",
							binding: { namespace: "data", segments: ["secret"] },
							visible: { kind: "ref", ref: { namespace: "data", segments: ["show"] } },
						},
						{ type: "field", id: "name", widget: "text", binding: { namespace: "data", segments: ["name"] } },
					],
				},
			},
			asyncFieldValidators: [{ id: "pending", fieldId: "name", validate: () => waiting }],
		},
	).createForm({
		initialData: { secret: "draft", show: false, name: "Ada" },
		onSubmit: async () => {
			calls++;
			return { ok: true };
		},
	});
	const pending = form.submit();
	assert.equal(form.getState().meta.validation.validating, true);
	form.dispose();
	const state = form.getState();
	assert.equal(state.meta.validation.validating, false);
	release([]);
	const result = await pending;
	assert.equal(result.ok, false);
	assert.equal(result.reason, "aborted");
	assert.equal(form.getState(), state);
	assert.equal(state.data.secret, "draft");
	assert.equal(calls, 0);
};
