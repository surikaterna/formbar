const { createSchemaForm, jsonSchemaProvider } = require("@formbar/from-schema");
const { FormRenderer, useSchemaForm } = require("@formbar/react-schema");
const React = require("react");
const { renderToString } = require("react-dom/server");
const { runRenderer } = require("./omission-renderer-cases.cjs");

runRenderer(
	{
		createSchemaForm,
		jsonSchemaProvider,
		FormRenderer,
		useSchemaForm,
		React,
		renderToString,
		loadClient: () => require("react-dom/client"),
	},
	"cjs",
).catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
