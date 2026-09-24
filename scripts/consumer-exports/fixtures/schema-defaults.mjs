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
		address: { type: "object", default: { city: "Paris", zip: "750" }, properties: { city: { type: "string" } } },
		tags: { type: "array", default: ["a"], items: { type: "string" } },
	},
};
const provider = jsonSchemaProvider();

async function check(initialData, expected, valid) {
	const submissions = [];
	let form;
	function Hook() {
		form = useSchemaForm(schema, {
			provider,
			side: "input",
			initialData,
			onSubmit: async ({ payload }) => {
				submissions.push(payload);
				return { ok: true, submitId: "packed" };
			},
		}).form;
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

await check(undefined, { name: "Ada", address: { city: "Paris", zip: "750" }, tags: ["a"] }, true);
await check(
	{ name: "Grace", address: { city: "Lyon" }, tags: [] },
	{ name: "Grace", address: { city: "Lyon" }, tags: [] },
	true,
);
await check({ name: undefined, address: null, tags: [] }, { name: undefined, address: null, tags: [] }, false);
console.log("SCHEMA_DEFAULTS packed SSR data/submit/reset/validation passed");
