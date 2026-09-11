import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packages = ["expressions", "core", "react", "arbiter"];

function check([expressions, core, react, arbiter], mode) {
	const form = core.createForm({ initialData: { quantity: 2 } });
	const runtime = expressions.createExpressionService({ namespaces: core.createCoreExpressionNamespaces(form) });
	const compiled = runtime.compile({
		kind: "op",
		op: "mul",
		args: [
			{ kind: "ref", ref: { namespace: "data", segments: ["quantity"] } },
			{ kind: "literal", value: 12 },
		],
	});
	assert.equal(compiled.ok, true);
	assert.deepEqual(runtime.evaluate(compiled.value), { ok: true, value: 24 });
	assert.equal(typeof react.useExpressionProps, "function");
	const bridge = arbiter.createExpressionOperator({ programs: {} });
	assert.equal(typeof bridge.operator, "function");
	bridge.dispose();
	runtime.dispose();
	form.dispose();
	console.log(`${mode}: four public package entries and expression smoke passed`);
}

function checkArrayWrite([expressions, core]) {
	const bad = new Array(1);
	Object.defineProperty(bad, "4294967295", { value: 7, enumerable: true });
	const form = core.createForm({ initialData: { x: [1] } });
	const service = expressions.createExpressionService({ namespaces: core.createCoreExpressionNamespaces(form) });
	const compiled = service.compile({ kind: "ref", ref: { namespace: "data", segments: ["x"] } });
	assert.equal(compiled.ok, true);
	assert.equal(service.resolveWritable(compiled.value).value(bad).ok, false);
	assert.deepEqual(form.getState().data.x, [1]);
	service.dispose();
	form.dispose();
}

function checkCleanup([expressions]) {
	let cleaned = 0;
	const provider = (cleanup) => ({ getSnapshot: () => ({ x: "secret" }), subscribe: () => cleanup });
	const service = expressions.createExpressionService({
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
	binding.subscribe(() => {});
	assert.doesNotThrow(() => service.dispose());
	assert.equal(cleaned, 1);
	assert.deepEqual(service.getLifecycleDiagnostics(), [{ code: "adapter" }]);
}

async function checkAsyncSnapshot([expressions]) {
	const errors = [];
	const rejected = (error) => errors.push(error);
	process.on("unhandledRejection", rejected);
	const service = expressions.createExpressionService({
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
		assert.deepEqual(service.evaluate(compiled.value), { ok: false, diagnostics: [{ code: "adapter" }] });
		await new Promise((resolve) => setTimeout(resolve, 25));
		assert.deepEqual(errors, []);
	} finally {
		service.dispose();
		process.off("unhandledRejection", rejected);
	}
}

function checkPlainThenJson([expressions]) {
	const value = JSON.parse('{"nested":{"then":"plain-json"}}');
	const service = expressions.createExpressionService({});
	const compiled = service.compile({ kind: "literal", value });
	assert.equal(JSON.stringify(service.evaluate(compiled.value)), JSON.stringify({ ok: true, value }));
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
	checkPlainThenJson(modules);
}
