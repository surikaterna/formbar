import { describe, expect, it } from "vitest";
import { serialHost } from "../../../../scripts/kalada-preflight/fixtures/row-write-hosts.js";
import { validateFormDefinition } from "../index.js";
import { program } from "./kalada-runtime-fixtures.js";

const names = ["a", "b", "c", "unused", "quantity", "subtotal", "total"];
const ref = (name: string) => ({ kind: "ref", ref: { namespace: "data", segments: [name] } });
const entry = (id: string, expression: unknown) => ({
	id,
	target: { namespace: "data", segments: [id] },
	expression: program(expression),
});
const admit = (computations: unknown[]) =>
	validateFormDefinition(
		{
			version: 1,
			id: "graph",
			root: { type: "output", id: "summary", format: "plain", value: program({ kind: "literal", value: null }) },
			computations,
		},
		{
			identity: { generation: "g1", fingerprint: "host" },
			strategy: serialHost().strategy,
			writeSources: {},
			policy: {
				generation: "g1",
				fingerprint: "host",
				widgets: {},
				renderers: {},
				actions: {},
				namespaces: { data: "available" },
				schema: {
					side: "input",
					availability: "complete",
					paths: names.map((name) => ({ path: [name], kind: "value" })),
				},
				ui: { availability: "complete", paths: [] },
			},
		},
	);

describe("static Kalada V1 computation graph", () => {
	it("admits an acyclic graph with canonical program dependencies", () => {
		const result = admit([
			entry("subtotal", ref("quantity")),
			entry("total", {
				kind: "numeric-binary",
				operator: "add",
				left: ref("subtotal"),
				right: { kind: "literal", value: 1 },
			}),
		]);
		expect(result.ok).toBe(true);
		if (result.ok)
			expect(result.value.prepared.admitted.computations.map((item) => item.expression.dependencies)).toMatchObject([
				[{ namespace: "data", path: ["quantity"] }],
				[{ namespace: "data", path: ["subtotal"] }],
			]);
	});

	it.each([
		[
			"duplicate id",
			[entry("a", { kind: "literal", value: 1 }), { ...entry("b", ref("a")), id: "a" }],
			["computations", 1, "id"],
			"DUPLICATE_COMPUTATION_ID",
		],
		[
			"duplicate target",
			[entry("a", ref("quantity")), { ...entry("b", ref("quantity")), target: { namespace: "data", segments: ["a"] } }],
			["computations", 1, "target"],
			"DUPLICATE_COMPUTATION_TARGET",
		],
		["self dependency", [entry("a", ref("a"))], ["computations", 0, "expression"], "SELF_DEPENDENCY"],
		[
			"unused cycle",
			[entry("unused", { kind: "literal", value: 1 }), entry("a", ref("b")), entry("b", ref("a"))],
			["computations", 1, "expression"],
			"COMPUTATION_CYCLE",
		],
	])("denies %s even when not used by a node", (_name, entries, path, message) => {
		expect(admit(entries)).toMatchObject({ ok: false, diagnostics: [{ path, message }] });
	});

	it("tracks both lazy branches, including the branch never selected at runtime", () => {
		const branch = "then";
		const lazy = {
			kind: "conditional",
			condition: { kind: "literal", value: true },
			[branch]: ref("b"),
			else: ref("c"),
		};
		expect(admit([entry("a", lazy), entry("b", { kind: "literal", value: 1 }), entry("c", ref("a"))])).toMatchObject({
			ok: false,
			diagnostics: [{ path: ["computations", 0, "expression"], message: "COMPUTATION_CYCLE" }],
		});
	});

	it("requires re-authoring of a bare legacy expression at the computation slot", () => {
		expect(admit([{ ...entry("a", ref("b")), expression: ref("b") }])).toMatchObject({
			ok: false,
			diagnostics: [{ path: ["computations", 0, "expression"], message: "RE-AUTHOR" }],
		});
	});
});
