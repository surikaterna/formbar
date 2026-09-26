const assert = require("node:assert/strict");

async function certified(api) {
	const sent = [];
	const definition = {
		version: 1,
		id: "certified",
		submission: { hiddenValues: "omit-inactive" },
		root: {
			type: "field",
			id: "secret",
			widget: "text",
			binding: { namespace: "data", segments: ["secret"] },
			visible: { kind: "literal", value: false },
		},
	};
	const prepared = api.createSchemaForm(
		{},
		{
			provider: api.jsonSchemaProvider(),
			side: "input",
			definition,
			fieldValidators: [
				{
					fieldId: "secret",
					validate: ({ data }) => (data.secret ? [{ code: "hidden", message: "hidden", severity: "error" }] : []),
				},
			],
		},
	);
	const form = prepared.createForm({
		initialData: { secret: "draft" },
		onSubmit: async ({ payload }) => {
			sent.push(JSON.parse(JSON.stringify(payload)));
			return { ok: true };
		},
	});
	assert.ok(form.validate().some((entry) => entry.code === "hidden"));
	assert.equal((await form.submit()).ok, true);
	assert.deepEqual(sent, [{}]);
	assert.equal(form.getState().data.secret, "draft");
	form.dispose();
}

async function serverIssue(api) {
	const definition = {
		version: 1,
		id: "server-issue",
		submission: { hiddenValues: "omit-inactive" },
		root: {
			type: "field",
			id: "secret",
			widget: "text",
			binding: { namespace: "data", segments: ["secret"] },
			visible: { kind: "literal", value: false },
		},
	};
	const form = api.createSchemaForm({}, { provider: api.jsonSchemaProvider(), side: "input", definition }).createForm({
		initialData: { secret: "draft" },
		onSubmit: async ({ payload }) => {
			assert.deepEqual(JSON.parse(JSON.stringify(payload)), {});
			return {
				ok: false,
				fieldIssues: [
					{
						code: "server",
						message: "server",
						severity: "error",
						path: { namespace: "data", segments: ["secret"] },
						source: { origin: "submit", validatorId: "server" },
					},
				],
			};
		},
	});
	assert.equal((await form.submit()).ok, false);
	assert.ok(form.getState().issues.some((entry) => entry.code === "server"));
	assert.equal(form.getState().data.secret, "draft");
	form.dispose();
}
module.exports = { certified, serverIssue };
