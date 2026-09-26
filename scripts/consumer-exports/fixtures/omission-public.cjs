const { createSchemaForm, jsonSchemaProvider } = require("@formbar/from-schema");
const { createForm } = require("@formbar/core");
const { run } = require("./omission-cases.cjs");

run({ createSchemaForm, jsonSchemaProvider, createForm }, "cjs").catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
