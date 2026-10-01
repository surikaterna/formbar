const { JSDOM } = require("jsdom");
const { compileFsx } = require("@formbar/fsx-authoring");
const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.window.document,
	HTMLInputElement: dom.window.HTMLInputElement,
	Event: dom.window.Event,
	IS_REACT_ACT_ENVIRONMENT: true,
});
import("./fsx-case.mjs")
	.then(async ({ exercise }) => {
		await exercise(compileFsx);
		await exercise(compileFsx, "item", true, " item ");
		await exercise(compileFsx, "product", true, "(product)");
		dom.window.close();
	})
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
