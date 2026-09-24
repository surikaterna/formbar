import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createArbiterPlugin } from "@formbar/arbiter";
import { createDeferredForm, createForm } from "@formbar/core";
import { createSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";
import { FormRenderer, useSchemaForm } from "@formbar/react-schema";
import { JSDOM } from "jsdom";
import React, { StrictMode, act } from "react";
import { renderToString } from "react-dom/server";

const require = createRequire(import.meta.url);
const { createRoot, hydrateRoot } = await import("react-dom/client");
const version = require("react/package.json").version;
const schema = { type: "object", required: ["name"], properties: { name: { type: "string", title: "Name" } } };
const provider = jsonSchemaProvider();
const prepared = createSchemaForm(schema, { provider, side: "input" });
assert.equal(prepared.validators.length, 1);
const packedForm = createForm({ initialData: {}, validators: prepared.validators });
assert.deepEqual(
	packedForm.validate().map((issue) => issue.code),
	["json-schema.required"],
);
packedForm.dispose();
const counters = { init: 0, dispose: 0, active: 0, maxActive: 0, middleware: 0 };
const plugin = {
	id: "audit",
	onInit() {
		counters.init++;
		counters.active++;
		counters.maxActive = Math.max(counters.maxActive, counters.active);
		return () => {
			counters.dispose++;
			counters.active--;
		};
	},
	evaluate: () => ({ fieldPolicy: [{ path: "name", required: true }] }),
};
const middleware = [
	{
		id: "audit",
		onInit: () => {
			counters.middleware++;
		},
	},
];
const seen = [];
function App() {
	const props = useSchemaForm(schema, {
		provider,
		side: "input",
		initialData: { name: "Ada" },
		initialUiState: {},
		autoFocusOnError: false,
		plugins: [plugin],
		middleware,
	});
	seen.push(props.form);
	return React.createElement(FormRenderer, props);
}

const eager = createForm({ plugins: [plugin] });
assert.equal(counters.init, 1);
eager.dispose();
assert.equal(counters.dispose, 1);
const html = renderToString(React.createElement(App));
assert.match(html, /Ada/);
assert.match(html, /noValidate/i);
assert.equal(counters.init, 1);
assert.equal(counters.middleware, 0);
assert.deepEqual(seen.pop().getState().fieldPolicy, []);
const beforeAbandon = counters.init;
function Abandoned() {
	throw new Error("abandoned");
}
assert.throws(
	() =>
		renderToString(React.createElement(React.Fragment, null, React.createElement(App), React.createElement(Abandoned))),
	/abandoned/,
);
assert.equal(counters.init, beforeAbandon);
seen.length = 0;
const dom = new JSDOM(`<!doctype html><div id="app">${html}</div>`, { url: "http://localhost/" });
Object.assign(globalThis, {
	window: dom.window,
	document: dom.window.document,
	HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
});
const errors = [];
const rootNode = document.getElementById("app");
let root;
await act(async () => {
	root = hydrateRoot(rootNode, React.createElement(App), { onRecoverableError: (error) => errors.push(String(error)) });
	await Promise.resolve();
});
assert.deepEqual(errors, []);
assert.equal(rootNode.querySelector("input").value, "Ada");
assert.equal(counters.init, 2);
assert.equal(counters.middleware, 1);
const hydrated = seen.pop();
seen.length = 0;
assert.equal(hydrated.getState().fieldPolicy.length, 0);
await act(async () => {
	hydrated.setValue("name", "Grace");
});
assert.notEqual(hydrated.getState().fieldPolicy.length, 0);
await act(async () => {
	root.unmount();
});
assert.equal(counters.init, counters.dispose);
assert.equal(hydrated.isDisposed(), false);
hydrated.dispose();
assert.equal(hydrated.isDisposed(), true);
seen.length = 0;

const strictNode = document.createElement("div");
document.body.append(strictNode);
const strictRoot = createRoot(strictNode);
const beforeStrict = { init: counters.init, dispose: counters.dispose };
await act(async () => {
	strictRoot.render(React.createElement(StrictMode, null, React.createElement(App)));
});
const strictForms = [...new Set(seen.splice(0))];
assert.equal(counters.init - beforeStrict.init, 2);
assert.equal(counters.dispose - beforeStrict.dispose, 1);
assert.equal(counters.active, 1);
assert.equal(counters.maxActive, 1);
assert.equal(strictForms.filter((form) => !form.isDisposed()).length, strictForms.length);
assert.ok(strictForms.length >= 1);
await act(async () => {
	strictRoot.unmount();
});
assert.equal(counters.active, 0);
assert.equal(counters.init, counters.dispose);
assert.equal(counters.middleware, counters.init - 1);
assert.equal(strictForms.length, version.startsWith("18.") ? 2 : 1);
const replayed = strictForms.at(-1);
assert.equal(replayed.isDisposed(), false);
const multiple = createRoot(strictNode);
await act(async () => {
	multiple.render(React.createElement(React.Fragment, null, React.createElement(App), React.createElement(App)));
});
assert.equal(counters.active, 2);
const twoForms = [...new Set(seen.splice(0))];
assert.equal(twoForms.length, 2);
await act(async () => {
	multiple.unmount();
});
assert.equal(counters.active, 0);
assert.equal(counters.init, counters.dispose);

const arbiter = createArbiterPlugin({ rules: [] });
const arbiterRuntime = createDeferredForm({ plugins: [arbiter] });
arbiterRuntime.activate();
assert.equal(arbiterRuntime.form.setValue("name", "Ada").ok, true);
arbiterRuntime.deactivate();
arbiterRuntime.activate();
assert.equal(arbiterRuntime.form.setValue("name", "Grace").ok, true);
arbiterRuntime.deactivate();
arbiterRuntime.form.dispose();
console.log(
	`LIFECYCLE react=${version} strict_candidates=${strictForms.length} init=${counters.init} dispose=${counters.dispose} maxActive=${counters.maxActive} hydrationErrors=${errors.length}`,
);
