const run = require("./case.cjs");
run({
	declarative: require("@formbar/declarative"),
	schema: require("@formbar/from-schema"),
	renderer: require("@formbar/react-schema"),
	React: require("react"),
	server: require("react-dom/server"),
}).catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
