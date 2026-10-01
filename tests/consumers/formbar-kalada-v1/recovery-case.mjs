import assert from "node:assert/strict";
import { KALADA_V1_ARTIFACT, createKaladaV1Host } from "@formbar/declarative";
import { FormRenderer } from "@formbar/react-schema";
import * as React from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

const act = React.act ?? (await import("react-dom/test-utils")).act;
const ref = (name) => ({ namespace: "data", segments: [name] });
const read = (name) => ({
	mode: "read",
	expression: {
		format: "kalada-program",
		version: 1,
		profile: "kalada-v1",
		expression: { kind: "ref", ref: ref(name) },
	},
});
const literal = (value) => ({ mode: "literal", value });

export function fixture(type, { binding = "name", renderer = "recovery.editor", fail = false, value = "bad" } = {}) {
	const identity = { generation: "recovery", fingerprint: "owned" };
	let owner;
	let revision = {};
	let retired = false;
	let dirty = false;
	let data = { name: value, other: value, fail: true, noise: "quiet" };
	const listeners = new Set();
	const granted = (ctx) =>
		!retired &&
		ctx.instance === owner &&
		ctx.policyGeneration === identity.generation &&
		ctx.policyFingerprint === identity.fingerprint;
	const rotate = () => {
		revision = {};
		for (const notify of listeners) notify();
	};
	const status = () => ({
		dirty,
		touched: dirty,
		submitted: false,
		validating: false,
		valid: !dirty,
		issues: { schema: [], extension: [] },
	});
	const strategy = {
		contract: "formbar-data-strategy-v1",
		current: (ctx) => (granted(ctx) ? revision : undefined),
		identity(ctx) {
			owner ??= ctx.instance;
			return {
				artifact: KALADA_V1_ARTIFACT,
				policyGeneration: identity.generation,
				policyFingerprint: identity.fingerprint,
			};
		},
		subscribe(ctx, notify) {
			if (!granted(ctx)) return () => {};
			listeners.add(notify);
			return () => listeners.delete(notify);
		},
		capture(ctx) {
			const token = revision;
			return {
				token,
				instance: owner,
				read(reference, scope) {
					return granted(ctx) &&
						token === revision &&
						reference.namespace === "data" &&
						reference.path.length === 1 &&
						Object.hasOwn(data, reference.path[0]) &&
						!scope.rows.length
						? { status: "found", value: data[reference.path[0]] }
						: { status: "denied" };
				},
			};
		},
		writeDirect(ctx, request) {
			if (!granted(ctx) || request.expectedInstance !== owner || request.expectedRevision !== revision)
				return { status: "stale" };
			const reference = request.reference;
			const key = reference.path[0];
			if (
				request.contract !== "formbar-direct-write-v1" ||
				request.targetKind !== "non-repeater" ||
				request.scope.rows.length ||
				reference.namespace !== "data" ||
				reference.path.length !== 1 ||
				!Object.hasOwn(data, key) ||
				(key === "fail" ? typeof request.value !== "boolean" : typeof request.value !== "string")
			)
				return { status: "denied" };
			data = { ...data, [key]: request.value };
			rotate();
			return { status: "applied" };
		},
		captureSubmission(ctx) {
			return granted(ctx) ? { status: "found", instance: owner, revision, data: { ...data } } : { status: "denied" };
		},
		submitCaptured() {
			return { status: "denied" };
		},
		captureLifecycle(ctx) {
			return granted(ctx)
				? {
						instance: owner,
						revision,
						initial: data,
						form: status(),
						field: () => ({ status: "found", value: status() }),
					}
				: { status: "denied" };
		},
		async validateLifecycle(ctx, request, fresh) {
			if (!granted(ctx) || request.revision !== revision || !fresh()) return { status: "stale" };
			dirty = !dirty;
			rotate();
			return { status: "applied", revision };
		},
		resetLifecycle() {
			return { status: "denied" };
		},
	};
	const editor =
		type === "field"
			? {
					type,
					id: "editor",
					widget: renderer,
					binding: ref(binding),
					props: { fail: literal(fail), nested: literal({ b: 2, a: 1 }) },
				}
			: {
					type,
					id: "editor",
					renderer,
					props: {
						fail: read("fail"),
						nested: literal({ b: 2, a: 1 }),
						current: read(binding),
						edit: { mode: "write", reference: ref(binding) },
					},
				};
	const props =
		type === "field"
			? { fail: { modes: ["literal"], expected: "boolean" }, nested: { modes: ["literal"], expected: "json" } }
			: {
					fail: { modes: ["read"], expected: "boolean" },
					nested: { modes: ["literal"], expected: "json" },
					current: { modes: ["read"], expected: "string" },
					edit: { modes: ["write"], expected: "string" },
				};
	const definition = {
		version: 1,
		id: "recovery",
		root: {
			type: "group",
			id: "root",
			children: [
				editor,
				...Object.keys(data).map((name) => ({
					type: "field",
					id: name,
					widget: name === "fail" ? "checkbox" : "text",
					binding: ref(name),
				})),
			],
		},
	};
	const targets = [
		[type === "field" ? "root.children[0].binding" : "root.children[0].props.edit.reference", binding],
		...Object.keys(data).map((name, i) => [`root.children[${i + 1}].binding`, name]),
	];
	const host = createKaladaV1Host({
		identity,
		definition,
		strategy,
		policy: {
			...identity,
			widgets: type === "field" ? { [renderer]: { children: "forbidden", props } } : {},
			renderers: type === "custom" ? { [renderer]: { children: "forbidden", props } } : {},
			actions: {},
			namespaces: { data: "available" },
			schema: {
				side: "input",
				availability: "complete",
				paths: Object.keys(data).map((name) => ({ path: [name], kind: "value" })),
			},
			ui: { availability: "complete", paths: [] },
		},
		installed: type === "field" ? { widgets: new Set([renderer]) } : { renderers: new Set([renderer]) },
		writeSources: Object.fromEntries(targets.map(([path]) => [path, "value"])),
		directLocations: Object.fromEntries(
			targets.map(([path, name]) => [
				path,
				{
					value: {
						target: ref(name),
						type: { kind: "primitive-type", name: name === "fail" ? "boolean" : "string" },
						writable: true,
					},
				},
			]),
		),
	});
	return {
		host,
		dispose() {
			host.dispose();
			retired = true;
		},
		write(name, value) {
			const control = host.snapshot().controls.find((entry) => entry.nodeId === name);
			assert.equal(control.writers.value(value).status, "applied");
		},
	};
}

export async function runRecovery(type) {
	let attempts = 0;
	let current;
	const failed = [];
	const precommit = [];
	const cleanups = [];
	function Editor(props) {
		attempts++;
		const writer = props.writers[type === "field" ? "value" : "edit"];
		const value = type === "field" ? props.value : props.props.current;
		React.useLayoutEffect(() => {
			precommit.push(writer("layout mutation").status);
		}, [writer]);
		React.useEffect(() => {
			current = writer;
			return () => cleanups.push(writer("cleanup mutation").status);
		}, [writer]);
		if (props.props.fail || value === "bad") {
			failed.push(writer);
			assert.equal(writer("render mutation").status, "uncommitted");
			throw new Error("recovery fixture failed");
		}
		return React.createElement("input", { id: props.a11y.controlId, value, readOnly: true });
	}
	function Replacement(props) {
		attempts++;
		const writer = props.writers[type === "field" ? "value" : "edit"];
		React.useLayoutEffect(() => {
			precommit.push(writer("replacement layout mutation").status);
		}, [writer]);
		React.useEffect(() => {
			current = writer;
			return () => cleanups.push(writer("replacement cleanup mutation").status);
		}, [writer]);
		return React.createElement("input", { id: props.a11y.controlId, value: "healthy replacement", readOnly: true });
	}
	let installed = fixture(type);
	const all = [installed];
	const element = (component = Editor, renderer = "recovery.editor") =>
		React.createElement(FormRenderer, {
			host: installed.host,
			[type === "field" ? "widgets" : "renderers"]: { [renderer]: component },
		});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const originalError = console.error;
	console.error = () => {};
	try {
		assert.match(renderToString(element()), /data-kalada-extension-error/);
		assert.equal(installed.host.snapshot().data.name, "bad");
		await act(async () => root.render(element()));
		assert.ok(container.querySelector("[data-kalada-extension-error]"));
		const count = attempts;
		await act(async () => root.render(element()));
		await act(async () => installed.write("noise", "unrelated"));
		await act(async () => installed.host.validate());
		assert.equal(attempts, count, "unchanged failed semantic inputs must not retry on new leases/revisions/metadata");
		if (type === "custom") {
			await act(async () => installed.write("name", "corrected"));
			assert.ok(attempts > count, "changed normalized current prop retries even if it fails again");
			const stillFailed = attempts;
			await act(async () => root.render(element()));
			assert.equal(attempts, stillFailed);
			await act(async () => installed.write("fail", false));
		} else await act(async () => installed.write("name", "corrected"));
		assert.equal(container.querySelector("[data-kalada-extension-error]"), null);
		for (const writer of failed) assert.equal(writer("old failed mutation").status, "uncommitted");
		await act(async () => {
			assert.equal((await current("committed").settled).status, "applied");
		});
		assert.equal(installed.host.snapshot().data.name, "committed");
		assert.ok(precommit.length > 0);
		assert.deepEqual(
			precommit,
			precommit.map(() => "uncommitted"),
		);
		for (const options of [
			{ fail: true, value: "corrected" },
			{ fail: true, binding: "other", value: "corrected" },
			{ fail: true, binding: "other", renderer: "recovery.second", value: "corrected" },
			{ fail: false, binding: "other", renderer: "recovery.second", value: "corrected" },
		]) {
			installed = fixture(type, options);
			all.push(installed);
			if (type === "custom") installed.write("fail", options.fail ?? false);
			const previousAttempts = attempts;
			await act(async () => root.render(element(Editor, options.renderer ?? "recovery.editor")));
			assert.ok(attempts > previousAttempts, "changed authored props/binding/renderer source retries");
			assert.equal(!!container.querySelector("[data-kalada-extension-error]"), options.fail === true);
			if (options.fail) {
				const count = attempts;
				await act(async () => root.render(element(Editor, options.renderer ?? "recovery.editor")));
				assert.equal(attempts, count);
			} else {
				await act(async () => {
					assert.equal((await current("other committed").settled).status, "applied");
				});
				assert.equal(installed.host.snapshot().data.other, "other committed");
			}
		}
		installed = fixture(type);
		all.push(installed);
		await act(async () => root.render(element()));
		const beforeSwap = attempts;
		await act(async () => root.render(element(Replacement)));
		assert.ok(attempts > beforeSwap, "implementation identity resets failed boundary");
		assert.equal(container.querySelector("[data-kalada-extension-error]"), null);
		await act(async () => {
			assert.equal((await current("replacement committed").settled).status, "applied");
		});
		assert.equal(installed.host.snapshot().data.name, "replacement committed");
		for (const writer of failed) assert.equal(writer("retired failure").status, "uncommitted");
		assert.deepEqual(
			precommit,
			precommit.map(() => "uncommitted"),
		);
		await act(async () => root.unmount());
		assert.equal(current("unmounted mutation").status, "uncommitted");
		assert.ok(cleanups.length > 0);
		assert.ok(cleanups.every((entry) => entry === "uncommitted"));
	} finally {
		await act(async () => root.unmount());
		console.error = originalError;
		for (const entry of all) entry.dispose();
		container.remove();
	}
}

export async function runRecoveryHydration(type) {
	const installed = fixture(type, { value: "corrected" });
	if (type === "custom") installed.write("fail", false);
	const precommit = [];
	let current;
	function Editor(props) {
		const writer = props.writers[type === "field" ? "value" : "edit"];
		precommit.push(writer("SSR/hydration render mutation").status);
		React.useLayoutEffect(() => {
			precommit.push(writer("hydration layout mutation").status);
		}, [writer]);
		React.useEffect(() => {
			current = writer;
		}, [writer]);
		return React.createElement("input", {
			id: props.a11y.controlId,
			value: type === "field" ? props.value : props.props.current,
			readOnly: true,
		});
	}
	const element = React.createElement(
		React.StrictMode,
		null,
		React.createElement(FormRenderer, {
			host: installed.host,
			[type === "field" ? "widgets" : "renderers"]: { "recovery.editor": Editor },
		}),
	);
	const container = document.createElement("div");
	container.innerHTML = renderToString(element);
	document.body.append(container);
	const errors = [];
	let root;
	try {
		assert.equal(installed.host.snapshot().data.name, "corrected");
		await act(async () => {
			root = hydrateRoot(container, element, { onRecoverableError: (error) => errors.push(error) });
		});
		assert.deepEqual(errors, []);
		assert.deepEqual(
			precommit,
			precommit.map(() => "uncommitted"),
		);
		await act(async () => {
			assert.equal((await current("hydrated committed").settled).status, "applied");
		});
		assert.equal(installed.host.snapshot().data.name, "hydrated committed");
	} finally {
		await act(async () => root?.unmount());
		installed.dispose();
		container.remove();
	}
	assert.equal(current("after unmount").status, "uncommitted");
}
