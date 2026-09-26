const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");

async function runRenderer(api, format) {
	const { React, renderToString, useSchemaForm, FormRenderer } = api;
	const path = (key) => ({ namespace: "data", segments: [key] });
	const schema = {
		type: "object",
		properties: {
			show: { type: "boolean" },
			secret: { type: "string" },
			name: { type: "string" },
		},
	};
	const definition = {
		version: 1,
		id: "packed-omit",
		submission: { hiddenValues: "omit-inactive" },
		root: {
			type: "group",
			id: "root",
			children: [
				{
					type: "field",
					id: "secret",
					widget: "text",
					binding: path("secret"),
					visible: { kind: "ref", ref: path("show") },
				},
				{ type: "field", id: "name", widget: "text", binding: path("name") },
			],
		},
	};
	const forms = [];
	const sent = [];
	function App() {
		const prepared = useSchemaForm(schema, {
			provider: api.jsonSchemaProvider(),
			side: "input",
			definition,
			initialData: { show: false, secret: "draft", name: "Ada" },
			initialUiState: {},
			autoFocusOnError: false,
			validators: [
				({ data }) =>
					data.name === "Ada"
						? [
								{
									path: path("name"),
									code: "candidate",
									message: "Change name",
									severity: "error",
									source: { origin: "function-validator", validatorId: "host" },
								},
							]
						: [],
			],
			onSubmit: async ({ payload }) => {
				sent.push(JSON.parse(JSON.stringify(payload)));
				return { ok: true };
			},
		});
		forms.push(prepared.form);
		return React.createElement(FormRenderer, prepared);
	}
	const html = renderToString(React.createElement(App));
	assert.match(html, /Ada/);
	assert.doesNotMatch(html, /data-formbar-node="secret"/);
	for (const form of forms.splice(0)) form.dispose();
	const dom = new JSDOM(`<!doctype html><div id="app">${html}</div>`, { url: "http://localhost/" });
	Object.assign(globalThis, {
		window: dom.window,
		document: dom.window.document,
		HTMLElement: dom.window.HTMLElement,
		IS_REACT_ACT_ENVIRONMENT: true,
	});
	const { hydrateRoot } = await api.loadClient();
	const errors = [];
	const container = document.getElementById("app");
	let root;
	await React.act(async () => {
		root = hydrateRoot(container, React.createElement(App), { onRecoverableError: (error) => errors.push(error) });
	});
	assert.deepEqual(errors, []);
	assert.equal(container.querySelector("input").value, "Ada");
	const form = forms.at(-1);
	await React.act(async () => {
		assert.equal((await form.submit()).ok, false);
	});
	assert.match(container.querySelector("[data-formbar-error-summary]").textContent, /Change name/);
	assert.equal(document.activeElement, container.querySelector("input"));
	assert.deepEqual(sent, []);
	await React.act(async () => {
		form.setValue("name", "Grace");
		assert.equal((await form.submit()).ok, true);
	});
	assert.deepEqual(sent, [{ show: false, name: "Grace" }]);
	assert.equal(form.getState().data.secret, "draft");
	assert.equal(Object.hasOwn(form.getState().meta.submission, "payload"), false);
	await React.act(async () => root.unmount());
	form.dispose();
	dom.window.close();
	console.log(
		`OMISSION_RENDERER format=${format} react=${React.version} hydration=pass focus=pass candidate=pass retained=pass`,
	);
}
module.exports = { runRenderer };
