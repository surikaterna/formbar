import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const expressionRequire = createRequire(new URL("../packages/expressions/package.json", import.meta.url));
const packages = ["expressions", "core", "react", "arbiter"];

function check([expressions, core, react, arbiter, kuery, expression], mode) {
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
	assert.equal(expressions.ExpressionProfile, expression.ExpressionProfile);
	assert.equal(kuery.ExpressionProfile, expression.ExpressionProfile);
	const custom = new kuery.ExpressionProfile("identity-smoke", [
		{ name: "identity:value", arity: 0, execute: () => 7 },
	]);
	const identityService = expressions.createExpressionService({ profile: custom });
	const identityProgram = identityService.compile({ kind: "op", op: "identity:value", args: [] });
	assert.deepEqual(identityService.evaluate(identityProgram.value), { ok: true, value: 7 });
	identityService.dispose();
	const externalProfile = new expressions.ExpressionProfile("reverse-identity", []);
	assert.equal(kuery.compileExpression({ kind: "literal", value: 1 }, { profile: externalProfile }).ok, true);
	const entries = new Map();
	const registry = {
		register: (name, handler) => entries.set(name, handler),
		get: (name) => entries.get(name),
		has: (name) => entries.has(name),
	};
	const bridge = arbiter.registerExpressionThenOperator(registry, { programs: new Map() });
	assert.equal(registry.get(arbiter.FORMBAR_VALUE_THEN_OPERATOR), bridge.handler);
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
	[
		"ESM",
		await Promise.all([
			...packages.map((name) => import(`@formbar/${name}`)),
			import("kuery"),
			import("kuery/expression"),
		]),
	],
	[
		"CJS",
		[
			...packages.map((name) => require(`@formbar/${name}`)),
			expressionRequire("kuery"),
			expressionRequire("kuery/expression"),
		],
	],
];
for (const [mode, modules] of modes) {
	check(modules, mode);
	checkArrayWrite(modules);
	checkCleanup(modules);
	await checkAsyncSnapshot(modules);
	checkPlainThenJson(modules);
}

const expressionsBuild = readFileSync(new URL("../packages/expressions/dist/index.js", import.meta.url), "utf8");
assert.match(expressionsBuild, /from\s+["']kuery\/expression["']/);
assert.doesNotMatch(expressionsBuild, /class ExpressionProfile/);
console.log("Formbar expressions build keeps the shared Kuery runtime external");
