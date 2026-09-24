import { describe, expect, it } from "vitest";
import type { SubmitDefinitionAdapter, SubmitStructuralWitness } from "../index.js";
import { FormStore } from "../store.js";
import { checkSubmitAdapterProof } from "../submit-adapter-proof.js";

const key = (name: string) => ({ kind: "key" as const, key: name });
const index = (n: number) => ({ kind: "index" as const, index: n });
const omitted = [key("private")];
const plan = (overrides: Partial<SubmitStructuralWitness> = {}): SubmitStructuralWitness => ({
	kind: "omission",
	omitted: [omitted],
	protected: [{ path: [key("shared")], value: "keep" }],
	rowAnchors: [],
	...overrides,
});
const original = { private: "secret", shared: "keep", public: "Ada" };
const projected = { shared: "keep", public: "Ada" };
const check = (final: unknown, witness: () => unknown = () => plan()) =>
	checkSubmitAdapterProof(original, projected, witness, final === projected ? structuredClone(final) : final);
const failure = (result: unknown) => {
	expect(result).toMatchObject({ ok: false, code: expect.stringMatching(/^(invalid_witness|unsafe_candidate)$/) });
	expect(JSON.stringify(result)).not.toContain("secret");
};

describe("submit adapter final structural proof (mock ownership, not privacy)", () => {
	it("accepts explicit no-omission and included edits, without invoking a runtime option", () => {
		const adapter: SubmitDefinitionAdapter = (capture) => ({
			data: structuredClone(capture.data),
			witness: {
				kind: "no-omission",
				omitted: [],
				protected: [],
				rowAnchors: [],
			},
		});
		const input = { data: { name: "Ada" }, uiState: {} };
		const result = adapter(input);
		expect(checkSubmitAdapterProof(input.data, result.data, () => result.witness, { name: "Grace" })).toEqual({
			ok: true,
			data: { name: "Grace" },
		});
		expect(check({ shared: "keep", public: "Grace" })).toEqual({ ok: true, data: { shared: "keep", public: "Grace" } });
	});

	it("checks FINAL bytes after structural safety, not only projected bytes", () => {
		failure(check({ ...projected, private: "reintroduced" }));
		failure(check({ public: "Ada" }));
		failure(check({ ...projected, shared: "changed" }));
		let called = false;
		failure(
			checkSubmitAdapterProof(
				original,
				projected,
				() => {
					called = true;
					return plan();
				},
				{ bad: new Array(2) },
			),
		);
		expect(called).toBe(false);
		failure(checkSubmitAdapterProof(original, projected, undefined, projected));
		failure(
			check(projected, () => {
				throw new Error("secret");
			}),
		);
		failure(check(projected, () => true));
		failure(check(projected, () => ({ kind: "no-omission", omitted: [], protected: [], rowAnchors: [] })));
		failure(check(projected, () => plan({ omitted: [] })));
		failure(
			check(projected, () => ({ kind: "omission", omitted: [omitted], protected: [], rowAnchors: [], safe: true })),
		);
		failure(check(projected, () => plan({ omitted: Array(257).fill(omitted) })));
		failure(checkSubmitAdapterProof(original, { public: "Ada" }, () => plan(), { public: "Ada" }));
	});

	it("rejects overlap, duplicate and missing protection; permits explicit included override", () => {
		failure(check(projected, () => plan({ protected: [{ path: omitted, value: "secret" }] })));
		failure(check(projected, () => plan({ omitted: [omitted, omitted] })));
		failure(check(projected, () => plan({ omitted: [[key("private")], [{ key: "private", kind: "key" }]] })));
		failure(check(projected, () => plan({ omitted: [[index(0)]] })));
		failure(check(projected, () => plan({ protected: [{ path: [key("shared")], value: "wrong" }] })));
		const before = { fields: { private: "hidden", override: "include" } };
		const after = { fields: { override: "include" } };
		const protectedPlan = plan({
			omitted: [[key("fields"), key("private")]],
			protected: [{ path: [key("fields"), key("override")], value: "include" }],
		});
		expect(checkSubmitAdapterProof(before, after, () => protectedPlan, structuredClone(after)).ok).toBe(true);
		failure(checkSubmitAdapterProof(before, after, () => protectedPlan, { fields: { override: "changed" } }));
		failure(checkSubmitAdapterProof(before, after, () => protectedPlan, {}));
		failure(
			checkSubmitAdapterProof(
				before,
				after,
				() => plan({ ...protectedPlan, protected: [{ path: [key("fields")], value: after.fields }] }),
				structuredClone(after),
			),
		);
	});

	it("keeps indexed rows in place with unique protected anchors for nested omissions", () => {
		const before = {
			rows: [
				{ id: "a", private: 1, label: "A" },
				{ id: "b", private: 2, label: "B" },
			],
		};
		const after = {
			rows: [
				{ id: "a", label: "A" },
				{ id: "b", label: "B" },
			],
		};
		const witness = plan({
			omitted: [
				[key("rows"), index(0), key("private")],
				[key("rows"), index(1), key("private")],
			],
			protected: [],
			rowAnchors: [{ array: [key("rows")], key: [key("id")] }],
		});
		expect(
			checkSubmitAdapterProof(before, after, () => witness, {
				rows: [
					{ id: "a", label: "edit" },
					{ id: "b", label: "B" },
				],
			}).ok,
		).toBe(true);
		failure(
			checkSubmitAdapterProof(before, after, () => witness, { rows: structuredClone([after.rows[1], after.rows[0]]) }),
		);
		failure(checkSubmitAdapterProof(before, after, () => witness, { rows: structuredClone([after.rows[0]]) }));
		failure(
			checkSubmitAdapterProof(before, after, () => witness, {
				rows: [{ ...after.rows[0], private: 1 }, after.rows[1]],
			}),
		);
		failure(checkSubmitAdapterProof(before, after, () => plan({ ...witness, rowAnchors: [] }), structuredClone(after)));
		failure(checkSubmitAdapterProof(before, { rows: [after.rows[0]] }, () => witness, structuredClone(after)));
		failure(checkSubmitAdapterProof(before, { rows: new Array(2) }, () => witness, after));
		failure(
			checkSubmitAdapterProof(
				before,
				{},
				() => plan({ omitted: [[key("rows")]], protected: [{ path: [key("rows"), index(0), key("id")], value: "a" }] }),
				{},
			),
		);
		const whole = plan({ omitted: [[key("rows")]], protected: [] });
		expect(checkSubmitAdapterProof(before, {}, () => whole, {}).ok).toBe(true);
		failure(checkSubmitAdapterProof(before, {}, () => whole, { rows: [] }));
		const numeric = { "0": "secret", visible: "ok" };
		expect(
			checkSubmitAdapterProof(numeric, { visible: "ok" }, () => plan({ omitted: [[key("0")]], protected: [] }), {
				visible: "ok",
			}).ok,
		).toBe(true);
		failure(
			checkSubmitAdapterProof(numeric, { visible: "ok" }, () => plan({ omitted: [[index(0)]], protected: [] }), {
				visible: "ok",
			}),
		);
	});

	it("never freezes or changes retained plain store identity; rejects detectable aliases/mutation", () => {
		const store = new FormStore({
			data: original,
			uiState: {},
			meta: { validation: {} },
			fieldMeta: {},
			fieldPolicy: [],
			issues: [],
		});
		const state = store.getState();
		const accepted = checkSubmitAdapterProof(state.data, projected, () => plan(), structuredClone(projected));
		expect(accepted.ok).toBe(true);
		if (accepted.ok) {
			expect(accepted.data).not.toBe(projected);
			expect(Object.isFrozen(accepted.data)).toBe(true);
		}
		failure(checkSubmitAdapterProof(state.data, state.data, () => plan(), projected));
		failure(checkSubmitAdapterProof(state.data, projected, () => plan(), projected));
		failure(
			checkSubmitAdapterProof(
				state.data,
				projected,
				() => {
					state.data.public = "tampered";
					return plan();
				},
				projected,
			),
		);
		expect(store.getState()).toBe(state);
		expect(state.data).toBe(original);
		expect(Object.isFrozen(state.data)).toBe(false);
		expect(Object.isFrozen(state.uiState)).toBe(false);
	});
});
