const assert = require("node:assert/strict");
const { certified, serverIssue } = require("./omission-certified.cjs");

const path = (key) => ({ namespace: "data", segments: [key] });
const field = (id, binding, extra = {}) => ({ type: "field", id, widget: "text", binding: path(binding), ...extra });
const hidden = { kind: "ref", ref: path("show") };
const provider = (api) => ({ provider: api.jsonSchemaProvider(), side: "input" });
const issue = (key, source = "host") => ({
	path: path(key),
	code: source,
	message: source,
	severity: "error",
	source: { origin: "function-validator", validatorId: source },
});
const definition = (children, mode = "omit-inactive") => ({
	version: 1,
	id: "packed-public",
	submission: { hiddenValues: mode },
	root: { type: "group", id: "root", children },
});
const base = () => definition([field("secret", "secret", { visible: hidden }), field("name", "name")]);
const draft = () => ({ show: false, secret: "draft", name: "Ada" });
const json = (value) => JSON.parse(JSON.stringify(value));

async function timeline(api) {
	const sent = [];
	const persisted = { secret: "previous server value", name: "old" };
	const form = api.createSchemaForm({}, { ...provider(api), definition: base() }).createForm({
		initialData: draft(),
		onSubmit: async ({ payload }) => {
			sent.push(json(payload));
			Object.assign(persisted, json(payload)); // PATCH-like mock: absence is not deletion.
			return { ok: true };
		},
	});
	assert.equal((await form.submit()).ok, true);
	assert.deepEqual(sent[0], { show: false, name: "Ada" });
	assert.equal(persisted.secret, "previous server value");
	assert.deepEqual(json(form.getState().data), draft());
	form.setValue("show", true);
	assert.equal((await form.submit()).ok, true);
	assert.deepEqual(sent[1], { show: true, secret: "draft", name: "Ada" });
	form.setValue("secret", "changed");
	form.setValue("show", false);
	assert.equal((await form.submit()).ok, true);
	assert.deepEqual(sent[2], sent[0]);
	assert.equal(form.getState().data.secret, "changed");
	form.reset();
	assert.deepEqual(json(form.getState().data), draft());
	assert.equal((await form.submit()).ok, true);
	assert.deepEqual(sent[3], sent[0]);
	assert.equal(Object.hasOwn(form.getState().meta.submission, "payload"), false);
	form.dispose();
}

async function ownership(api) {
	const cases = [
		[base(), { show: false, secret: "draft", name: "Ada", unknown: 1 }, { show: false, name: "Ada", unknown: 1 }],
		[definition([field("secret", "secret", { visible: hidden, submitWhenHidden: "include" })]), draft(), draft()],
		[definition([field("secret", "secret", { visible: hidden }), field("shared", "secret")]), draft(), draft()],
		[
			definition([
				field("parent", "parent", { visible: hidden }),
				field("child", "child", { binding: { namespace: "data", segments: ["parent", "child"] } }),
			]),
			{ show: false, parent: { child: "owned", extra: "unknown" } },
			{ show: false, parent: { child: "owned", extra: "unknown" } },
		],
	];
	for (const [config, input, expected] of cases) {
		const sent = [];
		const form = api.createSchemaForm({}, { ...provider(api), definition: config }).createForm({
			initialData: input,
			onSubmit: async ({ payload }) => {
				sent.push(json(payload));
				return { ok: true };
			},
		});
		assert.equal((await form.submit()).ok, true);
		assert.deepEqual(sent, [expected]);
		assert.deepEqual(json(form.getState().data), input);
		form.dispose();
	}
	const sent = [];
	const { submission: _policy, ...plainDefinition } = base();
	const plain = api.createSchemaForm({}, { ...provider(api), definition: plainDefinition });
	for (const form of [
		plain.createForm({ initialData: draft(), onSubmit: save }),
		api.createForm({ initialData: draft(), onSubmit: save }),
	]) {
		assert.equal((await form.submit()).ok, true);
		form.dispose();
	}
	assert.deepEqual(sent, [draft(), draft()]);
	function save({ payload }) {
		sent.push(json(payload));
		return { ok: true };
	}
}

async function nested(api) {
	const schema = {
		type: "object",
		properties: {
			show: { type: "boolean" },
			groups: {
				type: "array",
				items: {
					type: "object",
					properties: {
						id: { type: "string" },
						rows: {
							type: "array",
							items: {
								type: "object",
								properties: {
									secret: { type: "string" },
									kept: { type: "string" },
									id: { type: "string" },
									name: { type: "string" },
								},
							},
						},
					},
				},
			},
		},
	};
	const generated = api.createSchemaForm(schema, provider(api));
	function find(node) {
		if (node.type === "field" && node.binding.segments.at(-1) === "kept") return node.id;
		return node.children?.map(find).find(Boolean);
	}
	const id = find(generated.definition.root);
	assert.ok(id);
	const prepared = api.createSchemaForm(schema, {
		...provider(api),
		submission: { hiddenValues: "omit-inactive" },
		generation: { submitWhenHidden: { [id]: "include" } },
	});
	const data = {
		show: false,
		groups: [0, 1].map((outer) => ({
			id: `outer-${outer}`,
			rows: [0, 1].map((inner) => ({
				id: `inner-${inner}`,
				secret: `s${outer}${inner}`,
				kept: `k${outer}${inner}`,
				name: `n${outer}${inner}`,
			})),
		})),
	};
	const sent = [];
	const form = prepared.createForm({
		initialData: data,
		plugins: [
			{
				id: "arbiter",
				evaluate: ({ data: current }) => ({
					fieldPolicy: current.show
						? []
						: data.groups.flatMap((group, outer) =>
								group.rows.flatMap((_, inner) =>
									["secret", "kept"].map((key) => ({
										path: `groups.${outer}.rows.${inner}.${key}`,
										visible: false,
									})),
								),
							),
				}),
			},
		],
		onSubmit: async ({ payload }) => {
			sent.push(json(payload));
			return { ok: true };
		},
	});
	const result = await form.submit();
	assert.equal(result.ok, true, JSON.stringify(result));
	assert.deepEqual(sent[0], {
		show: false,
		groups: data.groups.map((group) => ({
			id: group.id,
			rows: group.rows.map(({ id, kept, name }) => ({ id, kept, name })),
		})),
	});
	assert.deepEqual(json(form.getState().data), data);
	form.setValue("show", true);
	assert.equal((await form.submit()).ok, true);
	assert.deepEqual(sent[1], { ...data, show: true });
	form.dispose();
}

async function validation(api) {
	const observed = [];
	const sent = [];
	const schema = {
		type: "object",
		properties: { show: { type: "boolean" }, name: { type: "string" } },
		if: { properties: { show: { const: false } }, required: ["show"] },
		// biome-ignore lint/suspicious/noThenProperty: JSON Schema requires the literal if/then keyword.
		then: { required: ["secret"] },
	};
	const config = {
		...provider(api),
		definition: base(),
		fieldValidators: [{ fieldId: "name", validate: capture }],
		asyncFieldValidators: [
			{
				id: "scoped-async",
				fieldId: "name",
				trigger: "onBlur",
				debounceMs: 0,
				validate: async (input) => capture(input),
			},
		],
	};
	const form = api.createSchemaForm(schema, config).createForm({
		initialData: { ...draft(), extra: "before" },
		initialUiState: { tab: "first" },
		transforms: [{ id: "egress", phase: "egress", transform: (data) => ({ ...data, extra: "after" }) }],
		validators: [capture],
		asyncValidators: [{ id: "legacy-async", validate: async (input) => capture(input) }],
		onSubmit: async ({ payload }) => {
			sent.push(payload);
			return { ok: true };
		},
	});
	function capture(input) {
		observed.push(input);
		return [];
	}
	const result = await form.submit({ requestId: "rc" }); // Ajv if/then required on omitted FINAL.
	assert.equal(result.ok, false);
	assert.deepEqual(sent, []);
	assert.equal(form.getState().data.secret, "draft");
	assert.ok(observed.length >= 4, JSON.stringify({ result, observed }));
	for (const input of observed) {
		assert.deepEqual(json(input.data), { show: false, name: "Ada", extra: "after" });
		assert.deepEqual(json(input.uiState), { tab: "first" });
		assert.equal(input.context.requestId, "rc");
	}
	assert.ok(result.fieldIssues.some((entry) => entry.code === "json-schema.required"));
	observed.length = 0;
	form.setValue("show", true);
	assert.equal((await form.submit({ requestId: "retry" })).ok, true);
	assert.equal(sent.length, 1);
	assert.deepEqual(json(sent[0]), { show: true, secret: "draft", name: "Ada", extra: "after" });
	assert.ok(Object.isFrozen(sent[0]));
	const finalObservations = observed.filter((input) => input.data.extra === "after");
	for (const input of finalObservations) {
		assert.strictEqual(input.data, sent[0]);
		assert.deepEqual(json(input.uiState), { tab: "first" });
		assert.equal(input.context.requestId, "retry");
	}
	assert.ok(finalObservations.length >= 4);
	assert.equal(form.getState().data.extra, "before");
	form.dispose();
}

async function guards(api) {
	for (const extra of [
		{ transforms: [{ id: "leak", phase: "egress", transform: (data) => ({ ...data, secret: "leak" }) }] },
		{ validators: [() => [issue("secret", "unowned")]] },
		{ validators: [() => [{ ...issue("secret", "root"), path: { namespace: "data", segments: [] } }]] },
		{ plugins: [{ id: "veto", beforeSubmit: () => [issue("name", "plugin")] }] },
	]) {
		const sent = [];
		const form = api.createSchemaForm({}, { ...provider(api), definition: base() }).createForm({
			initialData: draft(),
			...extra,
			onSubmit: async ({ payload }) => {
				sent.push(payload);
				return { ok: true };
			},
		});
		assert.equal((await form.submit()).ok, false);
		assert.deepEqual(sent, []);
		form.dispose();
	}
	const sent = [];
	const form = api.createSchemaForm({}, { ...provider(api), definition: base() }).createForm({
		initialData: draft(),
		onSubmit: async ({ payload }) => {
			sent.push(payload);
			return { ok: true };
		},
	});
	const controller = new AbortController();
	controller.abort();
	assert.equal((await form.submit(undefined, controller.signal)).ok, false);
	assert.deepEqual(sent, []);
	form.dispose();
}

async function lifecycle(api) {
	const sent = [];
	let release;
	const waiting = new Promise((resolve) => {
		release = resolve;
	});
	const prepared = api.createSchemaForm({}, { ...provider(api), definition: base() });
	const form = prepared.createForm({
		initialData: draft(),
		asyncValidators: [{ id: "pause", validate: () => waiting }],
		onSubmit: async ({ payload }) => {
			sent.push(json(payload));
			return { ok: true };
		},
	});
	const pending = form.submit();
	await assert.rejects(form.submit(), /already in progress/);
	form.reset();
	release([]);
	assert.equal((await pending).ok, false);
	assert.deepEqual(sent, []);
	assert.equal((await form.submit()).ok, true);
	assert.deepEqual(sent, [{ show: false, name: "Ada" }]);
	form.dispose();
	const disposed = prepared.createForm({
		initialData: draft(),
		asyncValidators: [
			{
				id: "pause",
				validate: () =>
					new Promise((resolve) => {
						release = resolve;
					}),
			},
		],
		onSubmit: async ({ payload }) => {
			sent.push(payload);
			return { ok: true };
		},
	});
	const stale = disposed.submit();
	disposed.dispose();
	release([]);
	// #346: disposing during a pending validator currently rejects instead of returning stale failure.
	await assert.rejects(stale, /OWNED_STATE_UNSUPPORTED/);
	assert.equal(sent.length, 1);
	const reference = {};
	const reentrant = prepared.createForm({
		initialData: draft(),
		validators: [
			() => {
				reference.current?.setValue("name", "changed");
				return [];
			},
		],
		onSubmit: async ({ payload }) => {
			sent.push(payload);
			return { ok: true };
		},
	});
	reference.current = reentrant;
	assert.equal((await reentrant.submit()).ok, false);
	assert.equal(sent.length, 1);
	reentrant.dispose();
}

async function run(api, format) {
	await timeline(api);
	await ownership(api);
	await nested(api);
	await validation(api);
	await guards(api);
	await certified(api);
	await serverIssue(api);
	await lifecycle(api);
	console.log(
		`OMISSION_PUBLIC format=${format} timeline=pass ownership=pass nested=pass validation=pass guards=pass certified=pass lifecycle=pass`,
	);
}
module.exports = { run };
