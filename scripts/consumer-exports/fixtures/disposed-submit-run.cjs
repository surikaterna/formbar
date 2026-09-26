const { createSchemaForm, jsonSchemaProvider } = require("@formbar/from-schema");

require("./disposed-submit.cjs")(createSchemaForm, jsonSchemaProvider).then(() => {
	console.log("DISPOSED_SUBMIT cjs ok");
});
