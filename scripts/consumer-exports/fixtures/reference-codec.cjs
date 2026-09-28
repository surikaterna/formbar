const assert = require("node:assert/strict");
const { ExpressionError, LIMITS, parseRef } = require("@formbar/expressions");

const scoped = parseRef({ namespace: "data", segments: ["0", 0], scope: "row" });
const unscoped = parseRef({ namespace: "data", segments: ["0", 0] });
assert.deepEqual(scoped, { namespace: "data", segments: ["0", 0], scope: "row" });
assert.deepEqual(unscoped, { namespace: "data", segments: ["0", 0] });
for (const ref of [scoped, unscoped]) {
	assert.ok(Object.isFrozen(ref) && Object.isFrozen(ref.segments));
	assert.notDeepEqual(ref.segments[0], ref.segments[1]);
	assert.equal(typeof ref.segments[0], "string");
	assert.equal(typeof ref.segments[1], "number");
}
assert.equal(Object.hasOwn(unscoped, "scope"), false);
assert.equal(
	parseRef({ namespace: "data", segments: Array(LIMITS.segments).fill("field") }).segments.length,
	LIMITS.segments,
);
assert.deepEqual(parseRef({ namespace: "data", segments: ["x".repeat(256), Number.MAX_SAFE_INTEGER] }).segments, [
	"x".repeat(256),
	Number.MAX_SAFE_INTEGER,
]);

for (const [input, code] of [
	[null, "invalid-input"],
	[{ segments: [] }, "invalid-input"],
	[{ namespace: "data" }, "invalid-input"],
	[{ namespace: "data", segments: [], scope: "constructor" }, "invalid-input"],
	[{ namespace: "__proto__", segments: [] }, "invalid-input"],
	[{ namespace: "data", segments: ["__proto__"] }, "invalid-input"],
	[{ namespace: "data", segments: ["x".repeat(257)] }, "invalid-input"],
	[{ namespace: "data", segments: [-1] }, "invalid-input"],
	[{ namespace: "data", segments: [Number.MAX_SAFE_INTEGER + 1] }, "invalid-input"],
	[{ namespace: "data", segments: Array(LIMITS.segments + 1).fill("field") }, "limit"],
]) {
	assert.throws(
		() => parseRef(input),
		(error) => error instanceof ExpressionError && error.code === code,
	);
}
let getterCalls = 0;
const accessor = { segments: [] };
Object.defineProperty(accessor, "namespace", {
	enumerable: true,
	get() {
		getterCalls++;
		return "data";
	},
});
assert.throws(
	() => parseRef(accessor),
	(error) => error instanceof ExpressionError && error.code === "invalid-input",
);
assert.equal(getterCalls, 0);
console.log("REFERENCE_CODEC cjs ok");
