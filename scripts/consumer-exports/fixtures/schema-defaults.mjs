import assert from "node:assert/strict";
import { jsonSchemaProvider } from "@formbar/from-schema";
import { useSchemaForm } from "@formbar/react-schema";
import React from "react";
import { renderToString } from "react-dom/server";

const schema = {
	type: "object",
	required: ["name", "address"],
	properties: {
		name: { type: "string", default: "Ada" },
		address: {
			type: "object",
			default: { city: "Paris", details: { $type: "undefined", value: 9 } },
			properties: { city: { type: "string" } },
		},
		tags: { type: "array", default: ["a"], items: { type: "string" } },
		metadata: { type: "object", default: { $type: "literal", value: 7 } },
	},
};
const provider = jsonSchemaProvider();

async function check(initialData, expected, valid) {
	const submissions = [];
	let form;
	function Hook() {
		const prepared = useSchemaForm(schema, {
			provider,
			side: "input",
			initialData,
			onSubmit: async ({ payload }) => {
				submissions.push(payload);
				return { ok: true, submitId: "packed" };
			},
		});
		assert.equal(prepared.warnings.filter((warning) => warning.channel === "initialization").length, 0);
		form = prepared.form;
		return null;
	}
	renderToString(React.createElement(Hook));
	assert.deepEqual(form.getState().data, expected);
	assert.equal(form.validate().length === 0, valid);
	assert.equal((await form.submit()).ok, valid);
	assert.deepEqual(submissions, valid ? [expected] : []);
	form.setValue("name", "Edited");
	form.reset();
	assert.deepEqual(form.getState().data, expected);
	assert.equal(form.validate().length === 0, valid);
	form.dispose();
}

const literals = { metadata: { $type: "literal", value: 7 } };
await check(
	undefined,
	{ name: "Ada", address: { city: "Paris", details: { $type: "undefined", value: 9 } }, tags: ["a"], ...literals },
	true,
);
await check(
	{ name: "Grace", address: { city: "Lyon" }, tags: [] },
	{ name: "Grace", address: { city: "Lyon" }, tags: [], ...literals },
	true,
);
await check(
	{ name: undefined, address: null, tags: [] },
	{ name: undefined, address: null, tags: [], ...literals },
	false,
);
console.log("SCHEMA_DEFAULTS packed SSR data/submit/reset/validation passed");
