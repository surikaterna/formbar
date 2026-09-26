import assert from "node:assert/strict";
import { path, admit, expression, lexical, program, ref } from "./boundary.mjs";

const lane = process.argv[2];
const normalized = (value) => JSON.parse(JSON.stringify(value));
const referenceCalls = { validate: 0, canonicalize: 0 };
const watched = (input, options) =>
	admit(input, {
		...options,
		onReference(_value, phase = "validate") {
			referenceCalls[phase]++;
		},
	});
function reject(input, reason, options, expectedCode) {
	const result = watched(input, options);
	assert.equal(result.ok, false, `${reason}: unexpectedly accepted`);
	assert.ok(result.message.startsWith(options?.slot ?? path), reason);
	if (expectedCode) assert.equal(result.message, `${options?.slot ?? path}.expression.ref: ${expectedCode}`);
	console.log(`REJECT ${lane} ${reason}: ${result.message}`);
}
function accept(input, options) {
	const result = watched(input, options);
	assert.equal(result.ok, true, JSON.stringify(result));
	return result.value;
}

const canonical = program(expression(ref(["show"])));
const accepted = accept(canonical);
assert.deepEqual(normalized(accepted.dependencies), [ref(["show"])]);
assert.deepEqual(accept(normalized(accepted.program)).program, accepted.program);
for (const scoped of [
	ref(["show"], "data", "orders"),
	ref(["show"], "data", "lines"),
	ref(["other", "show"], "data", "orders"),
	ref(["other", 0, "show"], "data", "orders"),
]) {
	const result = accept(program(expression(scoped)), { chain: lexical });
	assert.deepEqual(normalized(result.dependencies), [scoped]);
	assert.deepEqual(accept(normalized(result.program), { chain: lexical }).program, result.program);
}
assert.deepEqual(normalized(accept(program(expression(ref(["show", 0])))).dependencies), [ref(["show", 0])]);
assert.deepEqual(normalized(accept(program(expression(ref(["valid"], "form")))).dependencies), [
	ref(["valid"], "form"),
]);
assert.deepEqual(normalized(accept(program(expression(ref(["show", "dirty"], "field")))).dependencies), [
	ref(["show", "dirty"], "field"),
]);

for (const [name, invalid, options, expectedCode] of [
	["legacy Kuery", expression(ref(["show"]))],
	["format", { ...canonical, format: "other" }],
	["version", { ...canonical, version: 2 }],
	["profile", { ...canonical, profile: "other" }],
	["extra", { ...canonical, extra: true }],
	["node", program({ kind: "not-a-node" })],
	["dotted string", program(expression("data.show"))],
	["wrong ref shape", program(expression({ namespace: "data", segments: ["show"], extra: true }))],
	["unsafe segment", program(expression(ref(["__proto__"])))],
	["unsafe scope", program(expression(ref(["show"], "data", "constructor"))), { chain: lexical }],
	["unknown field", program(expression(ref(["missing", "valid"], "field")))],
	["field key", program(expression(ref(["show", "value"], "field")))],
	["unknown namespace", program(expression(ref(["show"], "admin")))],
	["unknown scope", program(expression(ref(["show"], "data", "other"))), { chain: lexical }],
	["forged scope", program(expression(ref(["show"], "data", "items")))],
	["sibling scope", program(expression(ref(["show"], "data", "lines"))), { chain: [lexical[0]] }],
	[
		"unresolved binding",
		program(expression(ref(["show"], "data", "lines"))),
		{ chain: [lexical[0], { ...lexical[1], binding: [] }] },
	],
	[
		"cyclic parent",
		program(expression(ref(["show"], "data", "lines"))),
		{ chain: [lexical[0], { ...lexical[1], parent: "lines" }] },
	],
	[
		"malformed parent",
		program(expression(ref(["show"], "data", "lines"))),
		{ chain: [lexical[0], { ...lexical[1], parent: "absent" }] },
	],
	[
		"duplicate alias",
		program(expression(ref(["show"], "data", "orders"))),
		{ chain: [lexical[0], { ...lexical[1], alias: "orders" }] },
	],
	["cross namespace", program(expression(ref(["show"], "ui", "orders"))), { chain: lexical }],
	[
		"descriptor namespace mismatch",
		program(expression(ref(["show"], "data", "lines"))),
		{ chain: [lexical[0], { ...lexical[1], namespace: "ui" }] },
	],
	[
		"top-level computation",
		program(expression(ref(["show"], "data", "orders"))),
		{ slot: "computations[0].expression" },
	],
	["missing capability", program(expression(ref(["missing"])))],
	["size", program({ kind: "literal", value: "x".repeat(4096) })],
	["depth", program({ kind: "literal", value: Array.from({ length: 32 }, () => 0).reduce((a, v) => [v, a], 0) })],
	["JSON nodes", program({ kind: "literal", value: Array.from({ length: 129 }, () => 0) })],
	[
		"AST nodes",
		program({
			kind: "conditional",
			condition: { kind: "literal", value: true }, // biome-ignore lint/suspicious/noThenProperty: Kalada's canonical conditional uses then.
			then: expression(ref(["show"])),
			else: expression(ref(["ready"])),
		}),
		{ limits: { maxAstNodes: 2 } },
	],
	[
		"AST depth",
		program({
			kind: "conditional",
			condition: { kind: "literal", value: true }, // biome-ignore lint/suspicious/noThenProperty: Kalada's canonical conditional uses then.
			then: {
				kind: "conditional",
				condition: { kind: "literal", value: true },
				// biome-ignore lint/suspicious/noThenProperty: Kalada's canonical conditional uses then.
				then: expression(ref(["show"])),
				else: expression(ref(["ready"])),
			},
			else: expression(ref(["ready"])),
		}),
		{ limits: { maxAstDepth: 1 } },
	],
	[
		"getter",
		Object.defineProperty({ ...canonical }, "extra", {
			enumerable: true,
			get() {
				throw new Error("getter called");
			},
		}),
	],
	["prototype", Object.assign(Object.create({ inherited: true }), canonical)],
	["nonfinite", program({ kind: "literal", value: Number.NaN })],
	["sparse", program({ kind: "literal", value: new Array(2) })],
])
	reject(invalid, name, options, expectedCode);
assert.ok(referenceCalls.validate > 0 && referenceCalls.canonicalize > 0, "both codec methods must be invoked");

if (lane === "candidate") {
	const { runCandidate } = await import("./candidate.mjs");
	await runCandidate(accept);
	reject(
		program(expression(ref(["show", 0]))),
		"reference length override",
		{
			limits: { maxReferenceLength: 8 },
			slot: "fixture.length",
		},
		"KALADA_LIMIT_EXCEEDED",
	);
}
console.log(
	`ADMISSION ${lane} positive roundtrip and negative fixtures passed; codec calls=${JSON.stringify(referenceCalls)}`,
);
