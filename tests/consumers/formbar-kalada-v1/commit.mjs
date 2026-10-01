import assert from "node:assert/strict";
import { KALADA_V1_ARTIFACT, createKaladaV1Host } from "@formbar/declarative";
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

function fixture() {
	let revision = {};
	let name = "original";
	let owner;
	const listeners = new Set();
	const granted = (context) =>
		context.instance === owner && context.policyGeneration === "lease" && context.policyFingerprint === "owned";
	const strategy = {
		contract: "formbar-data-strategy-v1",
		current: () => revision,
		identity(context) {
			owner ??= context.instance;
			return { artifact: KALADA_V1_ARTIFACT, policyGeneration: "lease", policyFingerprint: "owned" };
		},
		subscribe(context, notify) {
			if (!granted(context)) return () => {};
			listeners.add(notify);
			return () => listeners.delete(notify);
		},
		capture(context) {
			const token = revision;
			return {
				instance: owner,
				token,
				read(ref, scope) {
					return granted(context) &&
						token === revision &&
						ref.namespace === "data" &&
						JSON.stringify(ref.path) === '["name"]' &&
						!scope.rows.length
						? { status: "found", value: name }
						: { status: "denied" };
				},
			};
		},
		captureSubmission(context) {
			return granted(context) ? { status: "found", instance: owner, revision, data: { name } } : { status: "denied" };
		},
		submitCaptured() {
			return { status: "denied" };
		},
		writeDirect(context, request) {
			if (
				!granted(context) ||
				request.expectedInstance !== owner ||
				request.expectedRevision !== revision ||
				request.scope.rows.length ||
				request.reference.namespace !== "data" ||
				JSON.stringify(request.reference.path) !== '["name"]' ||
				typeof request.value !== "string"
			)
				return { status: "denied" };
			name = request.value;
			revision = {};
			for (const notify of listeners) notify();
			return { status: "applied" };
		},
	};
	const identity = { generation: "lease", fingerprint: "owned" };
	const ref = { namespace: "data", segments: ["name"] };
	const host = createKaladaV1Host({
		identity,
		strategy,
		definition: {
			version: 1,
			id: "lease",
			root: { type: "field", id: "name", label: "Name", widget: "packed.editor", binding: ref },
		},
		policy: {
			...identity,
			widgets: { "packed.editor": { children: "forbidden", props: {} } },
			renderers: {},
			actions: {},
			namespaces: { data: "available" },
			schema: { side: "input", availability: "complete", paths: [{ path: ["name"], kind: "value" }] },
			ui: { availability: "complete", paths: [] },
		},
		installed: { widgets: new Set(["packed.editor"]) },
		writeSources: { "root.binding": "value" },
		directLocations: {
			"root.binding": { value: { target: ref, type: { kind: "primitive-type", name: "string" }, writable: true } },
		},
	});
	return host;
}

async function leases() {
	const host = fixture();
	const original = host.snapshot().data;
	const Bad = (props) => {
		props.writers.value("SSR/render mutation");
		throw new Error("editor failed");
	};
	const element = React.createElement(FormRenderer, { host, widgets: { "packed.editor": Bad } });
	assert.match(renderToString(element), /data-kalada-extension-error/);
	assert.deepEqual(host.snapshot().data, original);
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const originalError = console.error;
	console.error = () => {};
	let current;
	let old;
	function Editor(props) {
		React.useEffect(() => {
			old = current;
			current = props.writers.value;
			return () => {
				props.writers.value("cleanup mutation");
			};
		}, [props.writers]);
		return React.createElement("input", {
			id: props.a11y.controlId,
			"aria-labelledby": props.a11y.labelId,
			readOnly: true,
			value: props.value,
		});
	}
	try {
		await act(async () => root.render(element));
		assert.deepEqual(host.snapshot().data, original);
		await act(async () =>
			root.render(React.createElement(FormRenderer, { host, widgets: { "packed.editor": Editor } })),
		);
		await act(async () => {
			assert.equal((await current("committed").settled).status, "applied");
		});
		assert.equal(host.snapshot().data.name, "committed");
		assert.deepEqual(Object.keys(host.snapshot().data), ["name"]);
		assert.equal(old("stale").status, "uncommitted");
		await act(async () => root.unmount());
		assert.equal(current("unmounted").status, "uncommitted");
		assert.equal(host.snapshot().data.name, "committed");
		assert.deepEqual(Object.keys(host.snapshot().data), ["name"]);
	} finally {
		console.error = originalError;
		host.dispose();
		container.remove();
	}
}

async function namespaces() {
	const first = fixture();
	const second = fixture();
	const Editor = (props) =>
		React.createElement("input", {
			id: props.a11y.controlId,
			"aria-labelledby": props.a11y.labelId,
			value: props.value,
			readOnly: true,
		});
	const element = React.createElement(
		React.Fragment,
		null,
		...[first, second].map((host, index) =>
			React.createElement(FormRenderer, { key: index, host, widgets: { "packed.editor": Editor } }),
		),
	);
	const container = document.createElement("div");
	container.innerHTML = renderToString(element);
	document.body.append(container);
	const ids = [...container.querySelectorAll("[id]")].map((node) => node.id);
	assert.equal(new Set(ids).size, ids.length);
	const errors = [];
	let root;
	try {
		await act(async () => {
			root = hydrateRoot(container, element, { onRecoverableError: (error) => errors.push(error) });
		});
		assert.deepEqual(errors, []);
		for (const label of container.querySelectorAll("label[for]"))
			assert.ok(label.closest("form").contains(label.control));
		assert.deepEqual(
			[...container.querySelectorAll("[id]")].map((node) => node.id),
			ids,
		);
	} finally {
		await act(async () => root?.unmount());
		first.dispose();
		second.dispose();
		container.remove();
	}
}

await leases();
await namespaces();
dom.window.close();
console.log(
	`PACKED_COMMIT_LEASES React ${React.version}: installed SSR/render failure/no mutation/committed write/stale cleanup/two-form SSR hydration IDs passed`,
);
