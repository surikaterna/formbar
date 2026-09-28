import { describe, expect, it } from "vitest";
import { checkSnapshot } from "../rc-pack-evidence";

describe("#371 audited pack checkout", () => {
	it("rejects invalid SHA/tree before invoking git, npm pack or GitHub", () => {
		expect(() => checkSnapshot("/nonexistent", "wrong", "also-wrong")).toThrow("dirty or drifting");
	});
});
