import { describe, expect, it } from "vitest";
import type { RuleWriteIntent } from "../contracts.js";
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

describe("applyRuleWrites", () => {
	it("writes to data path update data", () => {
		const state = makeState({ data: { x: 1 } });
		const writes: RuleWriteIntent[] = [{ path: "y", value: 2, mode: "set", ruleId: "r1" }];

		const result = applyRuleWrites(state, writes);
		expect(result.data).toEqual({ x: 1, y: 2 });
	});

	it("writes to $ui path update uiState", () => {
		const state = makeState({ uiState: { a: 1 } });
		const writes: RuleWriteIntent[] = [{ path: "$ui.visible", value: false, mode: "set", ruleId: "r1" }];

		const result = applyRuleWrites(state, writes);
		expect(result.uiState).toEqual({ a: 1, visible: false });
	});

	it("writes to nested data path", () => {
		const state = makeState({ data: { address: { city: "NYC" } } });
		const writes: RuleWriteIntent[] = [{ path: "address.zip", value: "10001", mode: "set", ruleId: "r1" }];

		const result = applyRuleWrites(state, writes);
		expect(result.data).toEqual({ address: { city: "NYC", zip: "10001" } });
	});

	it("delete mode removes data path", () => {
		const state = makeState({ data: { x: 1, y: 2 } });
		const writes: RuleWriteIntent[] = [{ path: "y", value: undefined, mode: "delete", ruleId: "r1" }];

		const result = applyRuleWrites(state, writes);
		expect(result.data).toEqual({ x: 1 });
	});

	it("delete mode removes $ui path", () => {
		const state = makeState({ uiState: { a: 1, b: 2 } });
		const writes: RuleWriteIntent[] = [{ path: "$ui.b", value: undefined, mode: "delete", ruleId: "r1" }];

		const result = applyRuleWrites(state, writes);
		expect(result.uiState).toEqual({ a: 1 });
	});

	it("does not mutate original state", () => {
		const state = makeState({ data: { x: 1 } });
		const writes: RuleWriteIntent[] = [{ path: "x", value: 99, mode: "set", ruleId: "r1" }];

		const result = applyRuleWrites(state, writes);
		expect(state.data).toEqual({ x: 1 });
		expect(result.data).toEqual({ x: 99 });
	});

	it("skips $state writes (arbiter-internal namespace)", () => {
		const state = makeState({ data: { x: 1 } });
		const writes: RuleWriteIntent[] = [{ path: "$state.foo", value: "bar", mode: "set", ruleId: "r1" }];

		const result = applyRuleWrites(state, writes);
		expect(result.data).toEqual({ x: 1 });
		expect(result.uiState).toEqual({});
	});

	it("skips $meta writes (arbiter-internal namespace)", () => {
		const state = makeState({ data: { x: 1 } });
		const writes: RuleWriteIntent[] = [{ path: "$meta.bar", value: 42, mode: "set", ruleId: "r1" }];

		const result = applyRuleWrites(state, writes);
		expect(result.data).toEqual({ x: 1 });
		expect(result.uiState).toEqual({});
	});

	it("skips $contributions writes (arbiter-internal namespace)", () => {
		const state = makeState({ data: { x: 1 } });
		const writes: RuleWriteIntent[] = [{ path: "$contributions.baz", value: true, mode: "set", ruleId: "r1" }];

		const result = applyRuleWrites(state, writes);
		expect(result.data).toEqual({ x: 1 });
		expect(result.uiState).toEqual({});
	});

	it("still routes $ui writes to uiState after filtering", () => {
		const state = makeState();
		const writes: RuleWriteIntent[] = [
			{ path: "$state.internal", value: "skip", mode: "set", ruleId: "r1" },
			{ path: "$ui.visible", value: true, mode: "set", ruleId: "r2" },
			{ path: "name", value: "kept", mode: "set", ruleId: "r3" },
		];

		const result = applyRuleWrites(state, writes);
		expect(result.uiState).toEqual({ visible: true });
		expect(result.data).toEqual({ name: "kept" });
	});
});
