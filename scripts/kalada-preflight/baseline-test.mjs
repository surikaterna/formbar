import assert from "node:assert/strict";

export function runBaselineTest(testLane) {
	const status = testLane("baseline-unfiltered", "bun", ["run", "test"]);
	console.log(
		JSON.stringify({
			lane: "baseline-unfiltered",
			status,
			result: status === 0 ? "passed" : "failed; inspect output (possible #317 release blocker)",
		}),
	);
	assert.equal(status, 0, "baseline unfiltered bun run test failed");
}
