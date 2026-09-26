const assert = require("node:assert/strict");
const { compileKaladaV1Program } = require("@kalada/core");
assert.equal(
	compileKaladaV1Program({
		format: "kalada-program",
		version: 1,
		profile: "kalada-v1",
		expression: { kind: "literal", value: true },
	}).ok,
	true,
);
if (process.argv[2] === "candidate") {
	assert.equal(typeof require("@kalada/syntax").parseKaladaV1Expression, "function");
	assert.equal(typeof require("@kalada/provider-routing").createCompositionRouter, "function");
}
