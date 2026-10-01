import type { ProductionRule } from "@arbitre/core";
import { createArbiterPlugin } from "@formbar/arbiter";
import { createForm } from "@formbar/core";
import type { FormPlugin } from "@formbar/core";
import { validateFormDefinition } from "@formbar/declarative";
import { describe, expect, test } from "vitest";

const legacyField = {
	type: "field",
	id: "name",
	binding: { namespace: "data", segments: ["name"] },
	widget: "text",
} as const;

describe("Arbiter policy at the Kalada V1 boundary", () => {
	test("legacy Kuery predicates without a Kalada host require re-authoring, not silent equivalence", () => {
		const result = validateFormDefinition({
			version: 1,
			id: "legacy-kuery",
			root: {
				type: "group",
				id: "root",
				children: [
					{
						...legacyField,
						visible: {
							kind: "op",
							op: "eq",
							args: [
								{ kind: "ref", ref: { namespace: "data", segments: ["status"] } },
								{ kind: "literal", value: "open" },
							],
						},
					},
				],
			},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.diagnostics[0]?.message).toBe("MISSING_POLICY");
	});

	test.each([
		["equality", { status: "open" }, "open"],
		["inequality", { status: { $ne: "closed" } }, "open"],
		["membership", { status: { $in: ["open", "pending"] } }, "pending"],
		["conjunction", { score: { $gte: 10 }, active: true }, "open"],
	] as const)("retains Arbiter %s policy authority as an ordered producer", (_name, when, matching) => {
		const rule: ProductionRule = {
			name: "governed",
			when: when as ProductionRule["when"],
			// biome-ignore lint/suspicious/noThenProperty: Serialized Arbitre rule stage, not a Promise.
			then: [{ $set: { "$formbar.fieldPolicy.name": { path: "/name", visible: false, required: true } } }],
		};
		const restrictive: FormPlugin = {
			id: "restrictive",
			evaluate: () => ({ fieldPolicy: [{ path: "/name", disabled: true, readOnly: true }] }),
		};
		const form = createForm({
			initialData: { name: "", status: "closed", score: 10, active: true },
			plugins: [restrictive, createArbiterPlugin({ rules: [rule] })],
		});
		form.setValue("status", matching);
		expect(form.getState().fieldPolicy).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ producerId: "restrictive", disabled: true, readOnly: true }),
				expect.objectContaining({ visible: false, required: true }),
			]),
		);
		form.dispose();
	});
});
