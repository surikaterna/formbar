import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packages = ["expressions", "expressions-kuery", "core", "react", "arbiter"];

function check(modules, mode) {
	const [neutral, kuery, core, react, arbiter] = modules;
	const form = core.createForm({ initialData: { quantity: 2 } });
	const runtime = neutral.createExpressionService({
		backend: kuery.createKueryBackend(),
		namespaces: core.createCoreExpressionNamespaces(form),
	});
	const compiled = runtime.compile({
		kind: "op",
		op: "multiply",
		args: [
			{ kind: "ref", ref: { namespace: "data", segments: ["quantity"] } },
			{ kind: "literal", value: 12 },
		],
	});
	assert.equal(compiled.ok, true);
	assert.deepEqual(runtime.evaluate(compiled.value), { ok: true, value: 24 });
	assert.equal(typeof react.useExpressionProps, "function");
	assert.deepEqual(runtime.getLifecycleDiagnostics(), []);
	const bridge = arbiter.createExpressionOperator({ backend: kuery.createKueryBackend(), programs: {} });
	assert.equal(typeof bridge.operator, "function");
	bridge.dispose();
	runtime.dispose();
	form.onDispose(() => {
		throw new Error("SECRET observer");
	});
	assert.doesNotThrow(() => form.dispose());
	assert.deepEqual(form.getDisposalDiagnostics(), [{ code: "adapter" }]);
	assert.equal(form.isDisposed(), true);
	const malformed = new Array(1);
	Object.defineProperty(malformed, "4294967295", { value: 7, enumerable: true });
	assert.throws(() => neutral.validateExpression({ kind: "literal", value: malformed }));
	console.log(`${mode}: five public package entries and arithmetic/core lifecycle smoke passed`);
}

function checkArrayWrite([neutral, kuery, core]) {
	const bad = new Array(1);
	Object.defineProperty(bad, "4294967295", { value: 7, enumerable: true });
	const form = core.createForm({ initialData: { x: [1] } });
	const service = neutral.createExpressionService({
		backend: kuery.createKueryBackend(),
		namespaces: core.createCoreExpressionNamespaces(form),
	});
	const compiled = service.compile({ kind: "ref", ref: { namespace: "data", segments: ["x"] } });
	assert.equal(compiled.ok, true);
	assert.equal(service.resolveWritable(compiled.value).value(bad).ok, false);
	assert.deepEqual(form.getState().data.x, [1]);
	service.dispose();
	form.dispose();
}

function checkCleanup([neutral, kuery]) {
	let cleaned = 0;
	let notified = 0;
	const provider = (cleanup) => ({ getSnapshot: () => ({ x: "secret" }), subscribe: () => cleanup });
	const service = neutral.createExpressionService({
		backend: kuery.createKueryBackend(),
		namespaces: {
			data: provider(() => {
				throw new Error("SECRET cleanup");
			}),
			other: provider(() => {
				cleaned++;
			}),
		},
	});
	const binding = service.resolveProps({
		value: { mode: "read", expression: { kind: "ref", ref: { namespace: "data", segments: ["x"] } } },
	});
	binding.getSnapshot();
	binding.subscribe(() => {
		notified++;
	});
	assert.doesNotThrow(() => service.dispose());
	service.dispose();
	assert.deepEqual({ cleaned, notified }, { cleaned: 1, notified: 1 });
	assert.equal(binding.getSnapshot().values.value, undefined);
	assert.deepEqual(service.getLifecycleDiagnostics(), [{ code: "adapter" }]);
}

async function checkAsyncSnapshot([neutral, kuery]) {
	const errors = [];
	const rejected = (error) => {
		errors.push(error);
	};
	process.on("unhandledRejection", rejected);
	const service = neutral.createExpressionService({
		backend: kuery.createKueryBackend(),
		namespaces: {
			data: {
				getSnapshot: async () => {
					throw new Error("SECRET snapshot");
				},
				subscribe: () => () => {},
			},
		},
	});
	try {
		const compiled = service.compile({ kind: "ref", ref: { namespace: "data", segments: [] } });
		assert.equal(compiled.ok, true);
		assert.deepEqual(service.evaluate(compiled.value), { ok: false, diagnostics: [{ code: "adapter" }] });
		await new Promise((resolve) => setTimeout(resolve, 25));
		assert.deepEqual(errors, []);
	} finally {
		service.dispose();
		process.off("unhandledRejection", rejected);
	}
}

async function checkPoisonedPromise([neutral, kuery, core]) {
	const errors = [];
	const rejected = (error) => {
		errors.push(error);
	};
	process.on("unhandledRejection", rejected);
	let hits = 0;
	const poison = () => {
		const promise = Promise.reject(new Error("SECRET rejection"));
		void Promise.prototype.then.call(promise, undefined, () => {});
		Object.defineProperty(promise, "constructor", {
			get() {
				hits++;
				throw new Error("SECRET getter");
			},
		});
		return promise;
	};
	try {
		assert.throws(() => neutral.copyJson(poison()), /^Error: invalid-input$/);
		assert.equal(
			neutral
				.createExpressionService({ backend: kuery.createKueryBackend() })
				.compile({ kind: "literal", value: poison() }).ok,
			false,
		);
		const form = core.createForm({ initialData: { x: 1 } });
		const service = neutral.createExpressionService({
			backend: kuery.createKueryBackend(),
			namespaces: core.createCoreExpressionNamespaces(form),
		});
		const compiled = service.compile({ kind: "ref", ref: { namespace: "data", segments: ["x"] } });
		assert.equal(service.resolveWritable(compiled.value).value(poison()).ok, false);
		assert.equal(form.getState().data.x, 1);
		await new Promise((resolve) => setTimeout(resolve, 25));
		assert.equal(hits, 0);
		assert.deepEqual(errors, []);
		service.dispose();
		form.dispose();
	} finally {
		process.off("unhandledRejection", rejected);
	}
}

function checkPlainThenJson([neutral]) {
	const values = [
		JSON.parse('{"then":"plain-json"}'),
		JSON.parse('{"then":null}'),
		JSON.parse('{"then":{"status":"plain-json"}}'),
		JSON.parse('{"nested":{"then":"plain-json","values":[{"then":null}]}}'),
	];
	for (const value of values) {
		assert.equal(JSON.stringify(neutral.copyJson(value)), JSON.stringify(value));
		const backend = {
			id: "identity",
			compile: (expression) => ({
				ok: true,
				value: { evaluate: (read) => (expression.kind === "ref" ? read(expression.ref) : expression.value) },
			}),
		};
		const literalService = neutral.createExpressionService({ backend });
		const literal = literalService.compile({ kind: "literal", value });
		assert.equal(literal.ok, true);
		assert.equal(JSON.stringify(literalService.evaluate(literal.value)), JSON.stringify({ ok: true, value }));
		const resultService = neutral.createExpressionService({
			backend: {
				id: "result",
				compile: () => ({ ok: true, value: { evaluate: () => value } }),
			},
		});
		const result = resultService.compile({ kind: "literal", value: 1 });
		assert.equal(JSON.stringify(resultService.evaluate(result.value)), JSON.stringify({ ok: true, value }));
		const namespaceService = neutral.createExpressionService({
			backend,
			namespaces: {
				data: {
					getSnapshot: () => value,
					subscribe: () => () => {},
				},
			},
		});
		const root = namespaceService.compile({ kind: "ref", ref: { namespace: "data", segments: [] } });
		assert.equal(JSON.stringify(namespaceService.evaluate(root.value)), JSON.stringify({ ok: true, value }));
		literalService.dispose();
		resultService.dispose();
		namespaceService.dispose();
	}
}

const modes = [
	["ESM", await Promise.all(packages.map((name) => import(`@formbar/${name}`)))],
	["CJS", packages.map((name) => require(`@formbar/${name}`))],
];
for (const [mode, modules] of modes) {
	check(modules, mode);
	checkArrayWrite(modules);
	checkCleanup(modules);
	await checkAsyncSnapshot(modules);
	await checkPoisonedPromise(modules);
	checkPlainThenJson(modules);
	console.log(`${mode}: R1/R2/R3 probes passed; poisoned getter hits=0 and plain JSON then fields preserved`);
}
