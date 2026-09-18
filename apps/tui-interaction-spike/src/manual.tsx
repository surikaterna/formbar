import type { SchemaFormResult } from "@formbar/from-schema";
import { renderStandaloneForm } from "@formbar/tui/standalone";
import { createFixtureForm, fixtureSchema } from "./fixture.js";

const form = createFixtureForm();
const schema = process.env.FORMBAR_TUI_SINGLE_FIELD === "1" ? singleFieldSchema() : fixtureSchema;
const instance = renderStandaloneForm({ form, schema, exitOnSubmit: false });

try {
	await instance.waitUntilExit();
} finally {
	instance.unmount();
	const finalData = form.getState().data;
	form.dispose();
	process.stdout.write(`\nFINAL_JSON=${JSON.stringify(finalData)}\n`);
}

function singleFieldSchema(): SchemaFormResult {
	const name = fixtureSchema.fields.find((field) => field.path === "name");
	if (name === undefined) throw new Error("Fixture name field is missing");
	return {
		...fixtureSchema,
		fields: [name],
		layout: { type: "section", id: "name-only", children: [{ type: "field", id: "name-field", path: "name" }] },
		optionsByPath: new Map(),
	};
}
