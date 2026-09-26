import { describe, expect, it } from "vitest";
import { decideExclusiveBindings } from "../exclusive-binding-decision.js";
import type { FormNode, ValidatedFormDefinition } from "../index.js";
import { validateFormDefinition } from "../index.js";
import { projectConcreteOwnership } from "../runtime-ownership.js";
import { projectRuntime } from "../runtime-projection.js";
import { binding, definition, field, runtime } from "./runtime-fixtures.js";

function mode(children: readonly FormNode[], hiddenValues: "include" | "omit-inactive" = "omit-inactive") {
	const base = definition(children);
	const result = validateFormDefinition({ ...base, submission: { hiddenValues } });
	if (!result.ok) throw Error("invalid fixture");
	return result.value;
}

function setup(validated: ValidatedFormDefinition, data: object, options = {}) {
	const { form } = runtime(validated, { initialData: data, ...options });
	const capture = form.captureState();
	const ownership = projectConcreteOwnership({ form, definition: validated, capture });
	const decision = decideExclusiveBindings(ownership);
	const lookup = (id: string) => {
		const owner = ownership.forField(id)?.[0];
		return owner && decision.forField(id, owner.instance.instanceKey)?.decision;
	};
	return { form, capture, ownership, decision, lookup };
}

const hidden = { visible: { kind: "literal" as const, value: false } };

describe("#321 same-capture exclusive binding decisions", () => {
	it("keeps the default packed consumer behavior and never treats a raw issue path as evidence", () => {
		const base = definition([field("secret", ["secret"], hidden)]);
		const result = setup(base, { secret: "draft" });
		expect(result.lookup("secret")).toBe("unknown");
		expect(result.ownership.forField("secret")?.[0]?.binding.segments).toEqual(["secret"]);
		expect(result.decision.forField("/secret", "secret")).toBeUndefined();
		expect(() => decideExclusiveBindings({ ...result.ownership })).toThrow("UNVERIFIED_CONCRETE_OWNERSHIP");
		expect(result.capture.state.data).toEqual({ secret: "draft" });
		result.form.dispose();
	});

	it("classifies exclusive siblings, overrides, conditional branches and exact/ancestor/descendant protectors", () => {
		const validated = mode([
			field("secret", ["secret"], hidden),
			field("sibling", ["sibling"], hidden),
			field("included", ["included"], { ...hidden, submitWhenHidden: "include" }),
			field("ancestor", ["object"], hidden),
			field("child", ["object", "child"]),
			field("parent", ["parent"]),
			field("descendant", ["parent", "child"], hidden),
			{
				type: "conditional",
				id: "switch",
				condition: { kind: "literal", value: true },
				// biome-ignore lint/suspicious/noThenProperty: Serialized conditional node.
				then: [field("view", ["shared"])],
				else: [field("hiddenView", ["shared"])],
			},
		]);
		const { lookup, decision, ownership, capture, form } = setup(validated, {
			secret: "draft",
			sibling: "draft",
			included: "draft",
			object: { child: "draft" },
			parent: { child: "draft" },
			shared: "draft",
		});
		expect(lookup("secret")).toBe("exclusive");
		expect(lookup("sibling")).toBe("exclusive");
		expect(lookup("included")).toBe("protected");
		expect(lookup("ancestor")).toBe("protected");
		expect(lookup("descendant")).toBe("protected");
		expect(lookup("hiddenView")).toBe("protected");
		expect(ownership.diagnostics).toBe(false);
		expect(Object.isFrozen(capture.state.data)).toBe(false);
		expect(decision.current()).toBe(true);
		form.setValue("secret", "new");
		expect(decision.current()).toBe(false);
		expect(lookup("secret")).toBeUndefined();
	});

	it("keeps row shapes: visible structural repeaters do not protect hidden child cells", () => {
		const validated = mode([
			{
				type: "repeater",
				id: "outer",
				scope: "outer",
				binding: binding(["a.b"]),
				children: [
					{
						type: "repeater",
						id: "inner",
						scope: "inner",
						binding: { namespace: "data", scope: "outer", segments: ["0"] },
						children: [
							field("secret", [], {
								...hidden,
								binding: { namespace: "data", scope: "inner", segments: ["deep.key"] },
							}),
							field("kept", [], { binding: { namespace: "data", scope: "inner", segments: ["visible"] } }),
						],
					},
				],
			},
		]);
		const { ownership, decision, form } = setup(validated, {
			"a.b": [
				{
					"0": [
						{ "deep.key": "one", visible: 1 },
						{ "deep.key": "two", visible: 2 },
					],
				},
			],
		});
		expect(
			decision.fields
				.filter((entry) => entry.owner.instance.nodeId === "secret")
				.map((entry) => [entry.owner.binding.segments, entry.decision]),
		).toEqual([
			[["a.b", 0, "0", 0, "deep.key"], "exclusive"],
			[["a.b", 0, "0", 1, "deep.key"], "exclusive"],
		]);
		expect(decision.repeaters.every((entry) => entry.decision === "protected")).toBe(true);
		expect(ownership.unknown).toEqual([]);
		form.setValue("a.b", [
			{
				"0": [
					{ "deep.key": "two", visible: 2 },
					{ "deep.key": "one", visible: 1 },
				],
			},
		]);
		expect(decision.current()).toBe(false);
	});

	it("rejects unknown subtrees, UI, numeric slots, failed conditions and stale lifecycle", () => {
		const validated = mode([
			field("unknown", ["object"], hidden),
			field("ui", [], { ...hidden, binding: { namespace: "ui", segments: ["secret"] } }),
			field("slot", ["array", 0], hidden),
		]);
		const { lookup, form, decision } = setup(validated, { object: { extra: 1 }, array: ["x"] });
		expect(lookup("unknown")).toBe("unknown");
		expect(lookup("ui")).toBe("unknown");
		expect(lookup("slot")).toBe("unknown");
		form.reset();
		expect(decision.current()).toBe(false);
		form.dispose();
		expect(decision.current()).toBe(false);
		const failed = mode([
			{
				type: "conditional",
				id: "bad",
				condition: { kind: "ref", ref: binding(["absent"]) },
				// biome-ignore lint/suspicious/noThenProperty: Serialized conditional node.
				then: [field("secret", ["secret"], hidden)],
			},
		]);
		const result = setup(failed, { secret: "private" });
		expect(result.ownership.diagnostics).toBe(true);
		expect(result.lookup("secret")).toBe("unknown");
		result.form.dispose();
	});

	it("projects once from the supplied capture and retains overrides beneath hidden ancestors per instance", () => {
		const validated = mode([
			{
				type: "group",
				id: "hiddenGroup",
				...hidden,
				children: [
					{
						type: "repeater",
						id: "rows",
						scope: "row",
						binding: binding(["rows"]),
						children: [
							field("override", [], {
								submitWhenHidden: "include",
								binding: { namespace: "data", scope: "row", segments: ["secret"] },
							}),
						],
					},
				],
			},
		]);
		const { form } = runtime(validated, { initialData: { rows: [{ secret: "a" }, { secret: "b" }] } });
		const capture = form.captureState();
		const state = capture.state;
		const ownership = projectConcreteOwnership({ form, definition: validated, capture });
		const decision = decideExclusiveBindings(ownership);
		expect(ownership.fields.map((field) => field.visible)).toEqual([false, false]);
		expect(decision.fields.map((entry) => entry.decision)).toEqual(["protected", "protected"]);
		expect(decision.repeaters[0]?.decision).toBe("protected");
		expect(form.getState()).toBe(state);
		expect(state.data).toEqual({ rows: [{ secret: "a" }, { secret: "b" }] });
		form.dispose();
	});

	it("rejects an earlier capture's projection even after visibility turns back on", () => {
		const validated = mode([
			field("secret", ["secret"], { visible: { kind: "ref", ref: binding(["show"]) } }),
			field("show", ["show"]),
		]);
		const { form } = runtime(validated, { initialData: { secret: "draft", show: false } });
		const oldCapture = form.captureState();
		const oldSnapshot = projectRuntime({ form, definition: validated, capture: oldCapture });
		form.setValue("show", true);
		const capture = form.captureState();
		const fresh = decideExclusiveBindings(projectConcreteOwnership({ form, definition: validated, capture }));
		expect(fresh.forField("secret", fresh.fields[0]?.owner.instance.instanceKey ?? "")?.decision).toBe("protected");
		// A stale snapshot is not part of the contract; even an untyped caller cannot inject it.
		const staleOptions = { form, definition: validated, capture, snapshot: oldSnapshot };
		const stale = projectConcreteOwnership(staleOptions);
		expect(decideExclusiveBindings(stale).fields[0]?.decision).toBe("protected");
		const other = mode([field("secret", ["secret"])]);
		const mismatched = projectConcreteOwnership({ ...staleOptions, definition: other });
		expect(decideExclusiveBindings(mismatched).fields[0]?.decision).toBe("protected");
		form.dispose();
	});

	it("fails closed for retained direct field and repeater entries after reset, reorder and dispose", () => {
		const validated = mode([
			field("secret", ["secret"], hidden),
			{ type: "repeater", id: "rows", scope: "row", binding: binding(["rows"]), ...hidden, children: [] },
		]);
		for (const invalidate of [
			(form: ReturnType<typeof runtime>["form"]) => form.reset(),
			(form: ReturnType<typeof runtime>["form"]) => form.setValue("rows", [{ value: 2 }, { value: 1 }]),
			(form: ReturnType<typeof runtime>["form"]) => form.dispose(),
		]) {
			const { form, decision } = setup(validated, { secret: "draft", rows: [] });
			const fieldEntry = decision.fields[0];
			const repeaterEntry = decision.repeaters[0];
			expect(fieldEntry?.decision).toBe("exclusive");
			expect(repeaterEntry?.decision).toBe("exclusive");
			invalidate(form);
			expect(decision.current()).toBe(false);
			expect(fieldEntry?.decision).toBe("unknown");
			expect(repeaterEntry?.decision).toBe("unknown");
			expect(decision.fields.map((entry) => entry.decision)).toEqual(["unknown"]);
			form.dispose();
		}
	});

	it("revokes direct entries when the caller's attempt aborts without a state write", () => {
		const { form, ownership } = setup(mode([field("secret", ["secret"], hidden)]), { secret: "draft" });
		const controller = new AbortController();
		const decision = decideExclusiveBindings(ownership, controller.signal);
		const entry = decision.fields[0];
		expect(entry?.decision).toBe("exclusive");
		controller.abort();
		expect(decision.current()).toBe(false);
		expect(entry?.decision).toBe("unknown");
		expect(decision.forField("secret", entry?.owner.instance.instanceKey ?? "")).toBeUndefined();
		form.dispose();
	});

	it("Arbiter visibility makes an otherwise visible field inactive without changing stored data", () => {
		const validated = mode([field("secret", ["secret"])]);
		const { form } = runtime(validated, {
			initialData: { secret: "draft", tick: 0 },
			plugins: [{ id: "policy", evaluate: () => ({ fieldPolicy: [{ path: "secret", visible: false }] }) }],
		});
		form.setValue("tick", 1);
		const ownership = projectConcreteOwnership({ form, definition: validated, capture: form.captureState() });
		expect(decideExclusiveBindings(ownership).fields[0]?.decision).toBe("exclusive");
		expect(form.getState().data).toEqual({ secret: "draft", tick: 1 });
		form.dispose();
	});

	it("revokes retained entries when Arbiter fieldPolicy changes", () => {
		let hiddenByPolicy = true;
		const validated = mode([field("secret", ["secret"])]);
		const { form } = runtime(validated, {
			initialData: { secret: "draft", tick: 0 },
			plugins: [{ id: "policy", evaluate: () => ({ fieldPolicy: [{ path: "secret", visible: !hiddenByPolicy }] }) }],
		});
		form.setValue("tick", 1);
		const ownership = projectConcreteOwnership({ form, definition: validated, capture: form.captureState() });
		const decision = decideExclusiveBindings(ownership);
		const entry = decision.fields[0];
		expect(entry?.decision).toBe("exclusive");
		hiddenByPolicy = false;
		form.setValue("tick", 2);
		expect(entry?.decision).toBe("unknown");
		const fresh = decideExclusiveBindings(
			projectConcreteOwnership({ form, definition: validated, capture: form.captureState() }),
		);
		expect(fresh.fields[0]?.decision).toBe("protected");
		form.dispose();
	});

	it("zero rows never mint a field owner; an inactive array container is exclusive only without protectors", () => {
		const repeater: FormNode = {
			type: "repeater",
			id: "rows",
			scope: "row",
			binding: binding(["rows"]),
			...hidden,
			children: [field("cell", [], { binding: { namespace: "data", scope: "row", segments: ["cell"] } })],
		};
		const validated = mode([repeater]);
		const empty = setup(validated, { rows: [] });
		expect(empty.ownership.forField("cell")).toEqual([]);
		expect(empty.decision.repeaters[0]?.decision).toBe("exclusive");
		empty.form.dispose();
		const protectedDefinition = mode([
			repeater,
			field("included", ["rows", 0, "cell"], { ...hidden, submitWhenHidden: "include" }),
		]);
		const protectedRows = setup(protectedDefinition, { rows: [{ cell: "draft" }] });
		expect(protectedRows.decision.repeaters[0]?.decision).toBe("protected");
		protectedRows.form.dispose();
	});
});
