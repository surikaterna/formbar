import { checkSubmitAdapterProof, clone } from "@formbar/core/internal/submit-proof";
import { describe, expect, it } from "vitest";
import { decideExclusiveBindings } from "../exclusive-binding-decision.js";
import { validateFormDefinition } from "../index.js";
import { bindOmissionSupplier, projectBoundOmission } from "../omission-supplier.js";
import { projectConcreteOwnership } from "../runtime-ownership.js";
import { binding, definition, field, runtime } from "./runtime-fixtures.js";

const hidden = { visible: { kind: "literal" as const, value: false } };

function prepared(nodes: Parameters<typeof definition>[0], mode: "include" | "omit-inactive" = "omit-inactive") {
	const result = validateFormDefinition({ ...definition(nodes), submission: { hiddenValues: mode } });
	if (!result.ok) throw Error("fixture");
	return result.value;
}

function setup(
	nodes: Parameters<typeof definition>[0],
	data: object,
	mode: "include" | "omit-inactive" = "omit-inactive",
	options = {},
) {
	const def = prepared(nodes, mode);
	const { form } = runtime(def, { initialData: data, ...options });
	bindOmissionSupplier(form, def);
	const capture = form.captureState();
	return { form, capture, project: () => projectBoundOmission(form, capture) };
}

describe("#327 real single-capture omission supplier", () => {
	it("keeps default include and removes only the inactive field, not the draft; checks FINAL bytes", () => {
		const nodes = [field("secret", ["secret"], hidden), field("name", ["name"])];
		const included = setup(nodes, { secret: "draft", name: "first", spare: "before" }, "include");
		expect(included.project()?.data).toEqual({ secret: "draft", name: "first", spare: "before" });
		included.form.dispose();
		const { form, capture, project } = setup(nodes, { secret: "draft", name: "first", spare: "before" });
		const state = form.getState();
		const result = project();
		expect(result?.data).toEqual({ name: "first", spare: "before" });
		expect(result?.witness.omitted).toEqual([[{ kind: "key", key: "secret" }]]);
		expect(result?.checkFinal({ name: "first", spare: "edited" })).toBe(true);
		expect(result?.checkFinal({ name: "edited", spare: "before" })).toBe(false);
		expect(result?.checkFinal({ name: "first", spare: "before", secret: "reintroduced" })).toBe(false);
		expect(
			checkSubmitAdapterProof(capture.state.data, result?.data, () => result?.witness, {
				name: "first",
				spare: "before",
				secret: "reintroduced",
			}).ok,
		).toBe(false);
		expect(form.getState()).toBe(state);
		expect(state.data).toEqual({ secret: "draft", name: "first", spare: "before" });
		expect(Object.isFrozen(state.data)).toBe(false);
		form.setValue("name", "changed");
		expect(result?.checkFinal({ name: "first", spare: "edited" })).toBe(false);
		form.dispose();
	});

	it("protects include-hidden overrides under hidden ancestors, conditional branches and Arbiter fieldPolicy", () => {
		const nodes = [
			{
				type: "group" as const,
				id: "group",
				...hidden,
				children: [field("secret", ["secret"]), field("override", ["override"], { submitWhenHidden: "include" })],
			},
			{
				type: "conditional" as const,
				id: "branch",
				condition: { kind: "literal" as const, value: true },
				// biome-ignore lint/suspicious/noThenProperty: Authored conditional fixture.
				then: [field("then", ["then"], hidden)],
				else: [field("else", ["else"], hidden)],
			},
		];
		// biome-ignore lint/suspicious/noThenProperty: Data key intentionally matches conditional branch name.
		const { form, project } = setup(nodes, { secret: 1, override: 2, then: 3, else: 4 });
		const result = project();
		expect(result?.data).toEqual({ override: 2 });
		expect(result?.checkFinal({ override: 3 })).toBe(false);
		form.dispose();
		const arbiter = setup([field("secret", ["secret"])], { secret: "draft", tick: 0 }, "omit-inactive", {
			plugins: [{ id: "policy", evaluate: () => ({ fieldPolicy: [{ path: "secret", visible: false }] }) }],
		});
		arbiter.form.setValue("tick", 1);
		const now = arbiter.form.captureState();
		expect(projectBoundOmission(arbiter.form, now)?.data).toEqual({ tick: 1 });
		arbiter.form.dispose();
	});

	it("preserves typed nested repeater row shape, dotted keys and included cell edits", () => {
		const nodes = [
			{
				type: "repeater" as const,
				id: "outer",
				scope: "outer",
				binding: binding(["a.b"]),
				children: [
					{
						type: "repeater" as const,
						id: "inner",
						scope: "inner",
						binding: { namespace: "data", scope: "outer", segments: ["0"] },
						children: [
							field("secret", [], {
								...hidden,
								binding: { namespace: "data", scope: "inner", segments: ["deep.key"] },
							}),
							field("kept", [], { binding: { namespace: "data", scope: "inner", segments: ["id"] } }),
							field("overrideCell", [], {
								...hidden,
								submitWhenHidden: "include",
								binding: { namespace: "data", scope: "inner", segments: ["override"] },
							}),
						],
					},
				],
			},
		];
		const draft = {
			"a.b": [
				{
					id: "outer-1",
					"0": [
						{ id: "a", "deep.key": 1, override: "A" },
						{ id: "b", "deep.key": 2, override: "B" },
					],
				},
			],
		};
		const { form, project } = setup(nodes, draft);
		const capture = form.captureState();
		const owner = projectConcreteOwnership({ form, definition: prepared(nodes), capture });
		const decision = decideExclusiveBindings(owner);
		expect(decision.fields.map((entry) => entry.decision).filter((entry) => entry === "exclusive")).toHaveLength(2);
		const result = project();
		expect(result?.data).toEqual({
			"a.b": [
				{
					id: "outer-1",
					"0": [
						{ id: "a", override: "A" },
						{ id: "b", override: "B" },
					],
				},
			],
		});
		expect(result?.witness.rowAnchors).toHaveLength(2);
		const final = clone(result?.data).value as typeof draft;
		const first = final["a.b"][0]?.["0"][0];
		if (!first) throw Error("missing row");
		first.id = "changed";
		expect(result?.checkFinal(final)).toBe(false); // row identity is an anchor, never editable
		const edited = clone(result?.data).value as typeof draft;
		expect(result?.checkFinal(edited)).toBe(true);
		const changedOverride = clone(result?.data).value as typeof draft;
		const cell = changedOverride["a.b"][0]?.["0"][0];
		if (!cell) throw Error("missing cell");
		cell.override = "changed";
		expect(result?.checkFinal(changedOverride)).toBe(false);
		expect(form.getState().data).toEqual(draft);
		form.dispose();
	});

	it("fails closed on shared/ancestor, unknown, absent anchor and unbound data", () => {
		const shared = setup([field("one", ["secret"], hidden), field("two", ["secret"], hidden)], {
			secret: "draft",
		});
		expect(shared.project()).toBeUndefined();
		shared.form.dispose();
		const overlap = setup([field("hidden", ["object"], hidden), field("child", ["object", "child"])], {
			object: { child: "keep" },
		});
		expect(overlap.project()?.data).toEqual({ object: { child: "keep" } });
		overlap.form.dispose();
		const unknown = setup([field("hidden", ["object"], hidden)], { object: { unknown: 1 } });
		expect(unknown.project()?.data).toEqual({ object: { unknown: 1 } });
		unknown.form.dispose();
		const rows = setup(
			[
				{
					type: "repeater",
					id: "rows",
					scope: "row",
					binding: binding(["rows"]),
					children: [
						field("secret", [], { ...hidden, binding: { namespace: "data", scope: "row", segments: ["secret"] } }),
					],
				},
			],
			{ rows: [{ secret: "x" }] },
		);
		expect(rows.project()).toBeUndefined();
		rows.form.dispose();
	});

	it("deletes only an exclusively inactive zero-row container, not an indexed array slot", () => {
		const empty = setup(
			[{ type: "repeater", id: "rows", scope: "row", binding: binding(["rows"]), ...hidden, children: [] }],
			{ rows: [], other: "kept" },
		);
		expect(empty.project()?.data).toEqual({ other: "kept" });
		expect(empty.project()?.checkFinal({ rows: [], other: "kept" })).toBe(false);
		empty.form.dispose();
		const slot = setup([field("slot", ["rows", 0], hidden)], { rows: ["do not splice"] });
		expect(slot.project()?.data).toEqual({ rows: ["do not splice"] });
		slot.form.dispose();
		const objectZero = setup([field("zero", ["0"], hidden)], { "0": "omitted", rows: ["kept"] });
		expect(objectZero.project()?.data).toEqual({ rows: ["kept"] });
		objectZero.form.dispose();
	});

	it("projects both conditional branches from their own capture without deleting the active branch", () => {
		const nodes = [
			field("show", ["show"]),
			{
				type: "conditional" as const,
				id: "branch",
				condition: { kind: "ref" as const, ref: binding(["show"]) },
				// biome-ignore lint/suspicious/noThenProperty: Authored conditional fixture.
				then: [field("thenField", ["thenField"])],
				else: [field("elseField", ["elseField"])],
			},
		];
		for (const show of [true, false]) {
			const { form, project } = setup(nodes, { show, thenField: "then", elseField: "else" });
			expect(project()?.data).toEqual(show ? { show, thenField: "then" } : { show, elseField: "else" });
			form.dispose();
		}
	});
});
