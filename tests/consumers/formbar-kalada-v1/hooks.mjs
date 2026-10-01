import assert from "node:assert/strict";
import { FormRenderer } from "@formbar/react-schema";
import { JSDOM } from "jsdom";
import * as React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

const act = React.act ?? (await import("react-dom/test-utils")).act;
const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.window.document,
	HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
});

function Editor(props) {
	const [count, setCount] = React.useState(0);
	return React.createElement(
		"div",
		null,
		React.createElement("input", {
			id: props.a11y.controlId,
			"aria-labelledby": props.a11y.labelId,
			"aria-describedby": props.a11y.describedBy,
			"aria-invalid": props.a11y.invalid,
			required: props.required,
			readOnly: props.readOnly,
			value: props.value,
		}),
		React.createElement(
			"button",
			{ type: "button", "aria-label": `increment ${props.nodeId}`, onClick: () => setCount(count + 1) },
			count,
		),
	);
}

// Isolated read-only renderer fixture: it issues no write, row or submission grants.
function hostFixture(type) {
	let revision = {};
	let ids = ["a", "b"];
	const listeners = new Set();
	const path = (id) => `root.children[${id === "a" ? 0 : 1}]`;
	return {
		definition: {
			version: 1,
			id: "read-only-renderer-fixture",
			root: {
				type: "group",
				id: "root",
				children: ["a", "b"].map((id) =>
					type === "field"
						? { type, id, widget: "packed.editor", binding: { namespace: "data", segments: [id] } }
						: { type, id, renderer: "packed.editor", props: {} },
				),
			},
		},
		currentRevision: () => revision,
		subscribe: (notify) => {
			listeners.add(notify);
			return () => listeners.delete(notify);
		},
		submit: async () => ({ status: "denied" }),
		validate: async () => ({ ok: false }),
		reset: () => ({ ok: false }),
		dispose() {
			listeners.clear();
		},
		publish(next) {
			ids = next;
			revision = {};
			for (const notify of listeners) notify();
		},
		snapshot() {
			return {
				revision,
				data: {},
				rows: [],
				outputs: [],
				tree: {
					key: "root",
					nodeId: "root",
					path: "root",
					type: "group",
					children: ids.map((id) => ({ key: id, nodeId: id, path: path(id), type, label: `Editor ${id}` })),
				},
				controls: ids.map((id) => ({
					key: id,
					nodeId: id,
					path: path(id),
					type,
					rendererId: "packed.editor",
					value: id,
					visible: true,
					disabled: false,
					readOnly: true,
					required: true,
					writers: {},
					props: { description: "Guidance" },
					lifecycle: {
						dirty: false,
						touched: true,
						valid: false,
						validating: false,
						submitted: false,
						issues: { schema: ["Read-only issue"], extension: [] },
					},
				})),
			};
		},
	};
}

async function run(type) {
	const host = hostFixture(type);
	const registration = type === "custom" ? "renderers" : "widgets";
	const element = React.createElement(FormRenderer, { host, [registration]: { "packed.editor": Editor } });
	const container = document.createElement("div");
	container.innerHTML = renderToString(element);
	document.body.append(container);
	const recoverable = [];
	let root;
	try {
		await act(async () => {
			root = hydrateRoot(container, element, { onRecoverableError: (error) => recoverable.push(error) });
		});
		assert.deepEqual(recoverable, []);
		const input = container.querySelector("input");
		assert.equal(document.getElementById(input.getAttribute("aria-labelledby")).textContent, "Editor a");
		assert.equal(input.getAttribute("aria-invalid"), "true");
		assert.equal(input.required, true);
		assert.match(
			input
				.getAttribute("aria-describedby")
				.split(" ")
				.map((id) => document.getElementById(id).textContent)
				.join(" "),
			/Guidance.*Read-only issue/,
		);
		await act(async () => container.querySelector('[aria-label="increment a"]').click());
		await act(async () => host.publish(["b", "a"]));
		assert.equal(container.querySelector('[aria-label="increment a"]').textContent, "1");
		await act(async () => host.publish([]));
		assert.equal(container.querySelector("input"), null);
		await act(async () => host.publish(["a"]));
		assert.equal(container.querySelector('[aria-label="increment a"]').textContent, "0");
		const original = console.error;
		console.error = () => {};
		try {
			await act(async () =>
				root.render(
					React.createElement(FormRenderer, {
						host,
						[registration]: {
							"packed.editor": () => {
								throw new Error("extension failed");
							},
						},
					}),
				),
			);
		} finally {
			console.error = original;
		}
		assert.ok(container.querySelector("form"));
		assert.ok(container.querySelector("[data-kalada-extension-error]"));
	} finally {
		await act(async () => root?.unmount());
		host.dispose();
		container.remove();
	}
}

for (const type of ["field", "custom"]) await run(type);
dom.window.close();
console.log(
	`PACKED_HOOK_BOUNDARIES React ${React.version}: widget/renderer SSR/hydration/reorder/hide/show/error/a11y passed`,
);
