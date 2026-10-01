const assert = require("node:assert/strict");

module.exports = async function run({ declarative, schema, renderer, React, server }) {
	const identity = { generation: "packed", fingerprint: "packed" };
	let owner;
	let revision = {};
	let name = "original";
	let outgoing;
	const listeners = new Set();
	const granted = (context) =>
		context.instance === owner && context.policyGeneration === "packed" && context.policyFingerprint === "packed";
	const strategy = {
		contract: "formbar-data-strategy-v1",
		identity(context) {
			owner ??= context.instance;
			return { artifact: declarative.KALADA_V1_ARTIFACT, policyGeneration: "packed", policyFingerprint: "packed" };
		},
		current: () => revision,
		subscribe(context, listener) {
			if (!granted(context)) return () => {};
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		capture(context) {
			const token = revision;
			return {
				token,
				instance: context.instance,
				read(ref, scope) {
					if (!granted(context) || token !== revision) return { status: "stale" };
					return ref.namespace === "data" && JSON.stringify(ref.path) === '["name"]' && !scope.rows.length
						? { status: "found", value: name }
						: { status: "denied" };
				},
			};
		},
		writeDirect(context, request) {
			if (!granted(context) || request.expectedInstance !== owner || request.expectedRevision !== revision)
				return { status: "stale" };
			if (
				request.contract !== "formbar-direct-write-v1" ||
				request.targetKind !== "non-repeater" ||
				request.scope.rows.length ||
				request.reference.namespace !== "data" ||
				JSON.stringify(request.reference.path) !== '["name"]' ||
				typeof request.value !== "string"
			)
				return { status: "denied" };
			name = request.value;
			revision = {};
			for (const listener of listeners) listener();
			return { status: "applied" };
		},
		captureSubmission(context) {
			return granted(context) ? { status: "found", instance: owner, revision, data: { name } } : { status: "denied" };
		},
		submitCaptured(context, request, fresh) {
			if (
				!granted(context) ||
				!fresh() ||
				request.instance !== owner ||
				request.revision !== revision ||
				request.contract !== "formbar-submission-v1" ||
				JSON.stringify(request.data) !== JSON.stringify({ name })
			)
				return { status: "stale" };
			outgoing = { ...request.data };
			return { status: "submitted" };
		},
	};
	const ref = { namespace: "data", segments: ["name"] };
	const program = { format: "kalada-program", version: 1, profile: "kalada-v1", expression: { kind: "ref", ref } };
	const definition = {
		version: 1,
		id: "packed",
		root: {
			type: "group",
			id: "root",
			children: [
				{ type: "field", id: "name", widget: "text", binding: ref, label: "Name" },
				{ type: "output", id: "output", value: program },
			],
		},
	};
	const host = declarative.createKaladaV1Host({
		definition,
		identity,
		strategy,
		policy: {
			...identity,
			widgets: {},
			renderers: {},
			actions: {},
			namespaces: { data: "available" },
			schema: { side: "input", availability: "complete", paths: [{ path: ["name"], kind: "value" }] },
			ui: { availability: "complete", paths: [] },
		},
		writeSources: { "root.children[0].binding": "value" },
		directLocations: {
			"root.children[0].binding": {
				value: { target: ref, type: { kind: "primitive-type", name: "string" }, writable: true },
			},
		},
	});
	assert.match(server.renderToString(React.createElement(renderer.FormRenderer, { host })), /data-kalada-v1/);
	const first = host.snapshot();
	const writer = first.controls[0].writers.value;
	assert.deepEqual(writer("edited"), { status: "applied" });
	assert.notEqual(writer("stale").status, "applied");
	const current = host.snapshot();
	const token = revision;
	assert.equal(current.outputs[0].value, "edited");
	assert.notEqual(current.controls[0].writers.value(42).status, "applied");
	assert.equal(revision, token);
	assert.equal((await host.submit()).status, "submitted");
	assert.deepEqual(outgoing, { name: "edited" });
	assert.throws(
		() => schema.createSchemaForm({}, { provider: schema.jsonSchemaProvider(), side: "input" }),
		/no longer supported/,
	);
	host.dispose();
	assert.notEqual(current.controls[0].writers.value("disposed").status, "applied");
	console.log("PACKED_FORMBAR canonical host/native SSR/write/output/submit/stale/type/disposal passed");
};
