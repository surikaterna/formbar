import { expect, it, vi } from "vitest";
import { snapshotAdmissionPolicy } from "../../../packages/declarative/src/validators/kalada-policy.js";
import { prepareKaladaV1Definition } from "../../../packages/declarative/src/validators/kalada-prepared-definition.js";
import { serialHost } from "./row-write-hosts.js";

const identity = { generation: "g1", fingerprint: "host" };
const target = { namespace: "data", segments: ["profile", "name"] };
const value = (literal: unknown) => ({
	format: "kalada-program",
	version: 1,
	profile: "kalada-v1",
	expression: { kind: "literal", value: literal },
});
const definition = {
	version: 1,
	id: "candidate",
	root: { type: "field", id: "name", widget: "text", binding: target, required: value(true) },
};
const policy = snapshotAdmissionPolicy({
	...identity,
	widgets: {},
	renderers: {},
	actions: {},
	namespaces: { data: "available" },
	schema: { side: "input", availability: "complete", paths: [{ path: target.segments, kind: "value" }] },
	ui: { availability: "complete", paths: [] },
});
const locations = {
	"root.binding": {
		profile: {
			target: { namespace: "data" as const, segments: ["profile"] },
			type: { kind: "primitive-type" as const, name: "json" as const },
			writable: true as const,
			properties: {
				name: { type: { kind: "primitive-type" as const, name: "string" as const }, writable: true as const },
			},
		},
	},
};
const install = (changed: Record<string, unknown> = {}) => {
	const host = serialHost();
	return {
		host,
		prepared: () =>
			prepareKaladaV1Definition({
				definition,
				policy,
				identity,
				strategy: host.strategy,
				writeSources: { "root.binding": "profile.name" },
				directLocations: locations,
				...changed,
			}),
	};
};

it("prepares inert V1 host evidence with exact reusable context and static computation graph", () => {
	const { host } = install();
	const capture = vi.fn(host.strategy.capture);
	const subscribe = vi.fn(() => () => {});
	const writeDirect = vi.fn(() => ({ status: "denied" as const }));
	const result = install({ strategy: { ...host.strategy, capture, subscribe, writeDirect } }).prepared();
	expect(result.admitted.slots.map((slot) => slot.path)).toEqual(["root.required"]);
	expect(result.admitted.targets.has("root.binding")).toBe(true);
	expect(capture).not.toHaveBeenCalled();
	expect(subscribe).not.toHaveBeenCalled();
	expect(writeDirect).not.toHaveBeenCalled();
	expect(result.writeSources["root.binding"]).toBe("profile.name");
});

it("rejects missing/foreign installation, mismatched identity and incomplete trusted write evidence", () => {
	const { host } = install();
	for (const [changed, path] of [
		[{ strategy: undefined }, "root: MISSING_STRATEGY"],
		[
			{
				strategy: {
					...host.strategy,
					identity: () => ({ artifact: "other", ...identity, policyGeneration: "g1", policyFingerprint: "host" }),
				},
			},
			"root: STALE_INSTALLATION",
		],
		[{ identity: { generation: "g2", fingerprint: "host" } }, "root: STALE_POLICY"],
		[{ writeSources: {} }, "root.binding: MISSING_WRITER"],
		[{ directLocations: undefined }, "root.binding: UNSUPPORTED_WRITE_TARGET_RE-AUTHOR"],
		[{ writeSources: { "root.binding": "profile.name + 1" } }, "root.binding: UNSUPPORTED_WRITE_TARGET_RE-AUTHOR"],
		[
			{ writeSources: { "root.binding": "profile.name", "root.props.edit.reference": "profile.name" } },
			"root.props.edit.reference: UNKNOWN_WRITER",
		],
	] as const) {
		expect(() => install(changed).prepared()).toThrow(path);
	}
});

it("denies Kuery at the exact reachable slot and rejects unsupported runtime slots before public exposure", () => {
	for (const property of ["visible", "disabled", "readOnly", "required"] as const) {
		expect(() =>
			install({
				definition: { ...definition, root: { ...definition.root, [property]: { kind: "literal", value: true } } },
			}).prepared(),
		).toThrow(`root.${property}: RE-AUTHOR`);
	}
	const condition = {
		...definition,
		root: {
			type: "conditional",
			id: "switch",
			condition: { kind: "literal", value: true },
			...JSON.parse('{"then":[]}'),
		},
	};
	expect(() => install({ definition: condition }).prepared()).toThrow("root.condition: RE-AUTHOR");
	const output = { ...definition, root: { type: "output", id: "out", value: value(1) } };
	expect(
		install({ definition: output, writeSources: {} })
			.prepared()
			.admitted.slots.map((slot) => slot.path),
	).toEqual(["root.value"]);
	expect(() =>
		install({ definition: { ...output, root: { ...output.root, value: { kind: "literal", value: 1 } } } }).prepared(),
	).toThrow("root.value: RE-AUTHOR");
	const action = { ...definition, root: { type: "action", id: "action", action: "submit", payload: value(1) } };
	expect(() => install({ definition: action }).prepared()).toThrow("root.payload: INVALID_ACTION_PAYLOAD");
	const arrayAction = {
		...definition,
		root: {
			type: "action",
			id: "append",
			action: "array.append",
			target: { namespace: "data", segments: ["rows"] },
			payload: { kind: "literal", value: 1 },
		},
	};
	expect(() => install({ definition: arrayAction }).prepared()).toThrow("root.payload: RE-AUTHOR");
	expect(() =>
		install({ definition: { ...definition, submission: { hiddenValues: "omit-inactive" } } }).prepared(),
	).toThrow("submission.hiddenValues: OMISSION_STRATEGY_REQUIRED");
	expect(() =>
		install({
			definition: {
				...definition,
				root: {
					...definition.root,
					props: { edit: { mode: "write", reference: target } },
				},
			},
		}).prepared(),
	).toThrow("root.props.edit.reference: UNSUPPORTED_V1_RE-AUTHOR");
});

it("matches concrete nested field ownership rather than granting its ancestor container authority", () => {
	const nested = { ...definition, root: { type: "group", id: "root", children: [definition.root] } };
	const path = "root.children[0].binding";
	const result = install({
		definition: nested,
		writeSources: { [path]: "profile.name" },
		directLocations: { [path]: locations["root.binding"] },
	}).prepared();
	expect(result.admitted.targets.has(path)).toBe(true);
});

it("prepares only trusted custom READ/WRITE declarations and checks static prop type and computation graph", () => {
	const host = serialHost();
	const custom = {
		...definition,
		root: {
			type: "custom",
			id: "editor",
			renderer: "demo.editor",
			props: {
				current: { mode: "read", expression: { ...value(null), expression: { kind: "ref", ref: target } } },
				edit: { mode: "write", reference: target },
			},
		},
	};
	const customPolicy = snapshotAdmissionPolicy({
		...policy,
		renderers: {
			"demo.editor": {
				children: "forbidden",
				props: {
					current: { modes: ["read"], expected: "string" },
					edit: { modes: ["write"], expected: "string" },
				},
			},
		},
	});
	const path = "root.props.edit.reference";
	const trusted = {
		definition: custom,
		policy: customPolicy,
		identity,
		strategy: host.strategy,
		writeSources: { [path]: "profile.name" },
		directLocations: { [path]: locations["root.binding"] },
	};
	expect(prepareKaladaV1Definition(trusted).admitted.slots.map((slot) => slot.path)).toEqual([
		"root.props.current.expression",
	]);
	expect(() =>
		prepareKaladaV1Definition({
			...trusted,
			definition: {
				...custom,
				root: {
					...custom.root,
					props: { ...custom.root.props, current: { mode: "read", expression: { kind: "literal", value: 1 } } },
				},
			},
		}),
	).toThrow("root.props.current.expression: RE-AUTHOR");
	expect(() =>
		prepareKaladaV1Definition({
			...trusted,
			policy: snapshotAdmissionPolicy({
				...customPolicy,
				renderers: {
					"demo.editor": {
						children: "forbidden",
						props: { current: { modes: ["read"], expected: "string" }, edit: { modes: ["write"], expected: "number" } },
					},
				},
			}),
		}),
	).toThrow(`${path}: INVALID_WRITE_TARGET`);
	expect(() =>
		prepareKaladaV1Definition({
			...trusted,
			definition: {
				...custom,
				computations: [{ id: "c", target, expression: value(1) }],
			},
		}),
	).toThrow(`${path}: UNSUPPORTED_WRITE_TARGET_RE-AUTHOR`);
});
