import { describe, expect, it } from "vitest";
import type { SubmitDefinitionAdapter } from "../submit-adapter-contract.js";
import { prepareOwnedSubmitAdapter } from "../submit-owned-adapter.js";

const key = (name: string) => ({ kind: "key" as const, key: name });
const witness = () => ({
	kind: "omission" as const,
	omitted: [[key("hidden")]],
	protected: [{ path: [key("shared")], value: "keep" }],
	rowAnchors: [],
});
const state = () => ({ data: { hidden: "secret", shared: "keep", included: "Ada" }, uiState: { tab: 1 } });
const adapter: SubmitDefinitionAdapter = ({ data }) => ({
	data: { shared: (data as ReturnType<typeof state>["data"]).shared, included: "Ada" },
	witness: witness(),
});

describe("owned adapter candidate and final proof (mock ownership only)", () => {
	it("calls adapter once on one owned capture; egress sees only projection; permits included edit", () => {
		const retained = state();
		const data = retained.data;
		const ui = retained.uiState;
		let calls = 0;
		const result = prepareOwnedSubmitAdapter(
			retained,
			(capture) => {
				calls++;
				expect(capture.data).not.toBe(data);
				expect(capture.uiState).not.toBe(ui);
				expect(Object.isFrozen(capture.data)).toBe(true);
				return adapter(capture);
			},
			[
				(value, context) => {
					expect(Object.keys(context).sort()).toEqual(["data", "phase", "uiState"]);
					expect(JSON.stringify(context)).not.toContain("secret");
					expect(JSON.stringify(value)).not.toContain("secret");
					return { ...(value as object), included: "Grace" };
				},
			],
		);
		expect(calls).toBe(1);
		expect(result).toEqual({ ok: true, data: { shared: "keep", included: "Grace" }, uiState: { tab: 1 } });
		expect(retained.data).toBe(data);
		expect(retained.uiState).toBe(ui);
		expect(retained).toEqual(state());
		expect(Object.isFrozen(data)).toBe(false);
		expect(Object.isFrozen(ui)).toBe(false);
		if (result.ok) {
			expect(Object.isFrozen(result.data)).toBe(true);
			expect(Object.isFrozen(result.uiState)).toBe(true);
		}
	});

	it("rejects absent, throwing, ambiguous witnesses and FINAL reintroduction/protected edits", () => {
		const fail = (supplier: SubmitDefinitionAdapter, egress: (value: unknown) => unknown = (v) => v) => {
			const retained = state();
			const result = prepareOwnedSubmitAdapter(retained, supplier, [egress]);
			expect(result).toMatchObject({ ok: false, code: expect.stringMatching(/^(invalid_witness|unsafe_candidate)$/) });
			expect(JSON.stringify(result)).not.toContain("secret");
			expect(retained).toEqual(state());
		};
		fail(() => ({ data: { shared: "keep", included: "Ada" } }) as SubmitDefinitionAdapter);
		fail(() => ({ data: { shared: "keep", included: "Ada" }, witness: witness(), extra: "secret" }));
		fail(() => {
			throw new Error("secret");
		});
		fail(() => ({ data: { shared: "keep", included: "Ada" }, witness: { ...witness(), omitted: [] } }));
		fail(adapter, (value) => ({ ...(value as object), hidden: "secret" }));
		fail(adapter, (value) => ({ ...(value as object), shared: "changed" }));
		fail(adapter, () => ({ shared: "keep", included: new Array(2) }));
		fail(adapter, () => state().data);
	});

	it("rejects detectable aliases and mutation without freezing retained data", () => {
		const retained = state();
		expect(prepareOwnedSubmitAdapter(retained, () => ({ data: retained.data, witness: witness() }))).toEqual({
			ok: false,
			code: "unsafe_candidate",
		});
		let projected: { shared: string; included: string };
		const result = prepareOwnedSubmitAdapter(
			retained,
			() => {
				projected = { shared: "keep", included: "Ada" };
				return { data: projected, witness: witness() };
			},
			[
				() => {
					projected.included = "tampered";
					return { shared: "keep", included: "Ada" };
				},
			],
		);
		expect(result).toEqual({ ok: false, code: "unsafe_candidate" });
		expect(retained).toEqual(state());
		expect(Object.isFrozen(retained.data)).toBe(false);
	});
});
