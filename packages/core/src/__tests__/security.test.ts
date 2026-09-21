import { describe, expect, it } from "vitest";
import { applyRuleWrites } from "../expression-integration.js";
import type { FormState } from "../state.js";

function makeState(overrides: Partial<FormState> = {}): FormState {
	return {
		data: overrides.data ?? {},
		uiState: overrides.uiState ?? {},
		meta: overrides.meta ?? { stage: "draft", validation: {} },
		fieldMeta: overrides.fieldMeta ?? {},
		fieldPolicy: overrides.fieldPolicy ?? [],
		issues: overrides.issues ?? [],
	};
}

describe("expression-integration prototype pollution", () => {
	it("rejects __proto__ in write path", () => {
		const state = makeState();
		expect(() =>
			applyRuleWrites(state, [{ path: "__proto__.polluted", value: true, mode: "set", ruleId: "r1" }]),
		).toThrow("Unsafe path segment rejected");
	});

	it("rejects constructor in write path", () => {
		const state = makeState();
		expect(() =>
			applyRuleWrites(state, [{ path: "constructor.prototype", value: true, mode: "set", ruleId: "r1" }]),
		).toThrow("Unsafe path segment rejected");
	});

	it("rejects prototype in $ui write path", () => {
		const state = makeState();
		expect(() => applyRuleWrites(state, [{ path: "$ui.prototype.x", value: true, mode: "set", ruleId: "r1" }])).toThrow(
			"Unsafe path segment rejected",
		);
	});

	it("rejects __proto__ in delete path", () => {
		const state = makeState();
		expect(() =>
			applyRuleWrites(state, [{ path: "__proto__.polluted", value: undefined, mode: "delete", ruleId: "r1" }]),
		).toThrow("Unsafe path segment rejected");
	});

	it("allows normal write paths", () => {
		const state = makeState({ data: {} });
		const result = applyRuleWrites(state, [{ path: "user.name", value: "Alice", mode: "set", ruleId: "r1" }]);
		expect((result.data as Record<string, unknown>).user).toEqual({ name: "Alice" });
	});
});
