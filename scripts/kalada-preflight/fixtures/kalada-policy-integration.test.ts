import { compileKaladaV1Program } from "@kalada/core";
import { describe, expect, it, vi } from "vitest";
import { normalizeActions } from "../../../packages/declarative/src/action-registry.js";
import { admitKaladaDefinitionWithPolicy } from "../../../packages/declarative/src/validators/kalada-definition-policy.js";
import { snapshotAdmissionPolicy } from "../../../packages/declarative/src/validators/kalada-policy.js";
import { createExpressionService } from "../../../packages/expressions/src/service.js";
import { attestProjectedInputPaths } from "../../../packages/from-schema/src/descriptors/kalada-path-authority.js";
import { jsonSchemaProvider, projectSchema } from "../../../packages/from-schema/src/index.js";
import { normalizeExtensions } from "../../../packages/react-schema/src/extension-registry.js";

const component = vi.fn();
const validateProps = vi.fn(() => true);
const handler = vi.fn();
const authorize = vi.fn(() => true);
const getSnapshot = vi.fn(() => ({ name: "ok" }));
const subscribe = vi.fn(() => () => {});
const service = createExpressionService({ namespaces: { data: { getSnapshot, subscribe } }, authorize });
const candidate = compileKaladaV1Program({
	format: "kalada-program",
	version: 1,
	profile: "kalada-v1",
	expression: { kind: "literal", value: true },
});
const resolve = vi.fn(() => ({ found: true as const, value: true }));
const evaluate = candidate.ok ? () => candidate.value.evaluate(resolve) : undefined;
const extensions = normalizeExtensions({
	widgets: [{ id: "host.widget", component, validateProps }],
	nodes: [{ id: "host.renderer", component, validateProps }],
});
const actions = normalizeActions([{ id: "host.action", handler }]);
const identity = Object.freeze({ generation: "installed-g1", fingerprint: "host-registrations-v1" });
// The test host supplies descriptors explicitly; installed registries do not yet provide them (#291).
const descriptor = { children: "forbidden", props: { title: { modes: ["literal"], expected: "string" } } };
const projected = projectSchema(
	{
		type: "object",
		additionalProperties: false,
		properties: {
			name: { type: "string" },
			address: { type: "object", additionalProperties: false, properties: { city: { type: "string" } } },
			total: { type: "string" },
			rows: { type: "array", items: { type: "string" } },
		},
	},
	{ provider: jsonSchemaProvider(), side: "input" },
).descriptors;
const paths = attestProjectedInputPaths(projected, new Map([[JSON.stringify(["rows"]), "row"]]));
const hostPolicy = () =>
	snapshotAdmissionPolicy({
		...identity,
		widgets: Object.fromEntries([...extensions.widgets.keys()].map((id) => [id, descriptor])),
		renderers: Object.fromEntries([...extensions.nodes.keys()].map((id) => [id, descriptor])),
		actions: Object.fromEntries([...actions.handlers.keys()].map((id) => [id, descriptor])),
		namespaces: { data: "available" },
		schema: { side: "input", ...paths },
		ui: { availability: "complete", paths: [] },
	});
const title = () => ({ title: { mode: "literal", value: "ok" } });
const field = () => ({
	type: "field",
	id: "field",
	widget: "host.widget",
	binding: { namespace: "data", segments: ["name"] },
	props: title(),
});
const childNodes = () => [
	field(),
	{ type: "custom", id: "custom", renderer: "host.renderer", props: title() },
	{ type: "action", id: "action", action: "host.action", props: title() },
];
const thenKey = "then";
const definition = (nodes: ReturnType<typeof childNodes>) => ({
	version: 1,
	id: "form",
	computations: [
		{
			id: "computed",
			target: { namespace: "data", segments: ["total"] },
			expression: {
				format: "kalada-program",
				version: 1,
				profile: "kalada-v1",
				expression: {
					kind: "ref",
					ref: { namespace: "data", segments: ["name"] },
				},
			},
		},
	],
	root: {
		type: "group",
		id: "root",
		children: [
			{
				type: "conditional",
				id: "gate",
				condition: {
					format: "kalada-program",
					version: 1,
					profile: "kalada-v1",
					expression: { kind: "literal", value: true },
				},
				[thenKey]: [{ type: "tabs", id: "tabs", tabs: [{ id: "tab", label: "", children: nodes }] }],
			},
		],
	},
});
const base = "root.children[0].then[0].tabs[0].children";

describe("#316 private host policy integration", () => {
	it("shares the public V1 ID namespace across collection aliases and nodes in both orders", () => {
		for (const key of ["tabs", "accordion"] as const) {
			const collection = key === "tabs" ? "tabs" : "items";
			const root = (id: string, alias: string, childId: string) => ({
				version: 1,
				id: "form",
				root: {
					type: key,
					id,
					[collection]: [
						{ id: alias, label: "first", children: [{ type: "group", id: childId, children: [] }] },
						{ id: "second", label: "second", children: [] },
					],
				},
			});
			expect(() => admitKaladaDefinitionWithPolicy(root("root", "root", "child"), hostPolicy(), identity)).toThrow(
				`root.${collection}[0].id: DUPLICATE_ALIAS`,
			);
			expect(() => admitKaladaDefinitionWithPolicy(root("root", "first", "first"), hostPolicy(), identity)).toThrow(
				`root.${collection}[0].children[0].id: DUPLICATE_NODE_ID`,
			);
			const valid = admitKaladaDefinitionWithPolicy(root("root", "first", "child"), hostPolicy(), identity);
			expect(valid.aliases.get("first")).toBe(`root.${collection}[0].id`);
			expect(valid.nodes.get("child")?.path).toBe(`root.${collection}[0].children[0]`);
		}
	});
	it("attests closed object values with their children, not open or opaque paths", () => {
		const program = (segments: string[]) => ({
			format: "kalada-program",
			version: 1,
			profile: "kalada-v1",
			expression: { kind: "ref", ref: { namespace: "data", segments } },
		});
		const input = (segments: string[]) => ({
			version: 1,
			id: "form",
			root: {
				type: "output",
				id: "read",
				value: program(segments),
			},
		});
		expect(paths.paths).toContainEqual({ path: ["address"], kind: "value" });
		expect(paths.paths).toContainEqual({ path: ["address", "city"], kind: "value" });
		expect(() => admitKaladaDefinitionWithPolicy(input(["address"]), hostPolicy(), identity)).not.toThrow();
		expect(() => admitKaladaDefinitionWithPolicy(input(["address", "city"]), hostPolicy(), identity)).not.toThrow();
		expect(() => admitKaladaDefinitionWithPolicy(input(["address", "unknown"]), hostPolicy(), identity)).toThrow(
			"root.value: UNATTESTED_PATH",
		);
		for (const schema of [
			{ type: "object", properties: { address: { type: "object", properties: { city: { type: "string" } } } } },
			{ type: "object", additionalProperties: false, properties: { address: true } },
		]) {
			const document = projectSchema(schema, { provider: jsonSchemaProvider(), side: "input" }).descriptors;
			expect(() => attestProjectedInputPaths(document)).toThrow();
		}
		expect(component).not.toHaveBeenCalled();
		expect(handler).not.toHaveBeenCalled();
		expect(resolve).not.toHaveBeenCalled();
	});
	it("admits installed IDs with inert host evidence and never executes registered callbacks", () => {
		const admitted = admitKaladaDefinitionWithPolicy(definition(childNodes()), hostPolicy(), identity);
		expect(admitted.fields.has("field")).toBe(true);
		expect(admitted.computations).toHaveLength(1);
		expect(admitted.computations[0]?.expression.dependencies).toEqual([{ namespace: "data", path: ["name"] }]);
		expect(candidate.ok).toBe(true);
		if (candidate.ok) expect(typeof candidate.value.evaluate).toBe("function");
		expect(typeof evaluate).toBe("function");
		expect(extensions.widgets.has("host.widget")).toBe(true);
		expect(extensions.nodes.has("host.renderer")).toBe(true);
		expect(actions.handlers.has("host.action")).toBe(true);
		expect(service.capabilities.namespaces.has("data")).toBe(true);
		expect(component).not.toHaveBeenCalled();
		expect(validateProps).not.toHaveBeenCalled();
		expect(handler).not.toHaveBeenCalled();
		expect(authorize).not.toHaveBeenCalled();
		expect(getSnapshot).not.toHaveBeenCalled();
		expect(subscribe).not.toHaveBeenCalled();
		expect(resolve).not.toHaveBeenCalled();
	});
	it("rejects missing/stale host evidence and nested forbidden declarations at exact paths", () => {
		const nodes = childNodes();
		const input = definition(nodes);
		const policy = hostPolicy();
		expect(() => admitKaladaDefinitionWithPolicy(input, undefined as never, identity)).toThrow("root: MISSING_POLICY");
		expect(() => admitKaladaDefinitionWithPolicy(input, policy, { ...identity, generation: "g2" })).toThrow(
			"root: STALE_POLICY",
		);
		for (const [index, key, group] of [
			[0, "widget", "widgets"],
			[1, "renderer", "renderers"],
			[2, "action", "actions"],
		] as const) {
			const absent = { ...policy, [group]: {} };
			expect(() => admitKaladaDefinitionWithPolicy(input, absent, identity)).toThrow(
				`${base}[${index}].${key}: MISSING_POLICY`,
			);
		}
		const withoutProp = snapshotAdmissionPolicy({
			...policy,
			widgets: { "host.widget": { children: "forbidden", props: {} } },
		});
		expect(() => admitKaladaDefinitionWithPolicy(input, withoutProp, identity)).toThrow(
			`${base}[0].widget.props.title: MISSING_POLICY`,
		);
		const widget = nodes[0];
		if (!widget) throw new Error("missing widget fixture");
		Object.assign(widget.props.title, {
			mode: "read",
			expression: {
				format: "kalada-program",
				version: 1,
				profile: "kalada-v1",
				expression: { kind: "literal", value: "ok" },
			},
		});
		Reflect.deleteProperty(widget.props.title, "value");
		expect(() => admitKaladaDefinitionWithPolicy(input, policy, identity)).toThrow(
			`${base}[0].widget.props.title.mode: FORBIDDEN_PROP_MODE`,
		);
		Object.assign(widget.props.title, { mode: "literal", value: "ok" });
		Reflect.deleteProperty(widget.props.title, "expression");
		const renderer = nodes[1];
		if (!renderer) throw new Error("missing renderer fixture");
		Object.assign(renderer, { children: [{ ...field(), id: "nested-field" }] });
		expect(() => admitKaladaDefinitionWithPolicy(input, policy, identity)).toThrow(
			`${base}[1].renderer.children: FORBIDDEN_CHILDREN`,
		);
		expect(component).not.toHaveBeenCalled();
		expect(validateProps).not.toHaveBeenCalled();
		expect(handler).not.toHaveBeenCalled();
		expect(authorize).not.toHaveBeenCalled();
		expect(getSnapshot).not.toHaveBeenCalled();
		expect(subscribe).not.toHaveBeenCalled();
		expect(resolve).not.toHaveBeenCalled();
	});
	it("rejects a duplicate nested field ID at its exact path before host child policy", () => {
		const nodes = childNodes();
		const renderer = nodes[1];
		if (!renderer) throw new Error("missing renderer fixture");
		Object.assign(renderer, { children: [field()] });
		expect(() => admitKaladaDefinitionWithPolicy(definition(nodes), hostPolicy(), identity)).toThrow(
			`${base}[1].children[0].id: DUPLICATE_NODE_ID`,
		);
	});
	it("requires input schema evidence for a data-bound repeater even without child fields", () => {
		const input = {
			version: 1,
			id: "form",
			root: {
				type: "repeater",
				id: "rows",
				scope: "row",
				binding: { namespace: "data", segments: ["rows"] },
				children: [],
			},
		};
		const policy = hostPolicy();
		const output = snapshotAdmissionPolicy({ ...policy, schema: { ...policy.schema, side: "output" } });
		expect(() => admitKaladaDefinitionWithPolicy(input, output, identity)).toThrowError(
			"root.binding: MISSING_SCHEMA_POLICY",
		);
		const unavailable = snapshotAdmissionPolicy({ ...policy, namespaces: { data: "unavailable" } });
		expect(() => admitKaladaDefinitionWithPolicy(input, unavailable, identity)).toThrowError(
			"root.binding.namespace: MISSING_NAMESPACE_POLICY",
		);
		expect(admitKaladaDefinitionWithPolicy(input, policy, identity).scopes.row).toBeDefined();
	});
	it("proves every read and write against separate typed host path authorities", () => {
		const policy = hostPolicy();
		const input = definition(childNodes());
		const gate = input.root.children[0];
		Object.assign(gate.condition, { expression: { kind: "ref", ref: { namespace: "data", segments: ["missing"] } } });
		expect(() => admitKaladaDefinitionWithPolicy(input, policy, identity)).toThrow(".condition: UNATTESTED_PATH");
		Object.assign(gate.condition, { expression: { kind: "ref", ref: { namespace: "ui", segments: ["name"] } } });
		expect(() => admitKaladaDefinitionWithPolicy(input, policy, identity)).toThrow(
			".condition.namespace: MISSING_NAMESPACE_POLICY",
		);
		Object.assign(gate.condition, { expression: { kind: "literal", value: true } });
		const nodes = gate[thenKey][0].tabs[0].children;
		Object.assign(nodes[0], { binding: { namespace: "data", segments: ["missing"] } });
		expect(() => admitKaladaDefinitionWithPolicy(input, policy, identity)).toThrow(
			`${base}[0].binding: UNATTESTED_PATH`,
		);
		Object.assign(nodes[0], { binding: { namespace: "data", segments: ["name"] } });
		const scalarRepeater = {
			version: 1,
			id: "scalar",
			root: {
				type: "repeater",
				id: "repeat",
				scope: "row",
				binding: { namespace: "data", segments: ["name"] },
				children: [],
			},
		};
		expect(() => admitKaladaDefinitionWithPolicy(scalarRepeater, policy, identity)).toThrow(
			"root.binding: UNATTESTED_PATH",
		);
		const partial = snapshotAdmissionPolicy({ ...policy, schema: { ...policy.schema, availability: "partial" } });
		expect(() => admitKaladaDefinitionWithPolicy(input, partial, identity)).toThrow("MISSING_SCHEMA_POLICY");
	});
	it("does not treat a numeric segment as a string key or infer unknown projected paths", () => {
		const policy = hostPolicy();
		const numeric = snapshotAdmissionPolicy({
			...policy,
			schema: { ...policy.schema, paths: [...policy.schema.paths, { path: ["0"], kind: "value" }] },
		});
		const input = {
			version: 1,
			id: "typed",
			root: {
				type: "output",
				id: "out",
				value: {
					format: "kalada-program",
					version: 1,
					profile: "kalada-v1",
					expression: {
						kind: "ref",
						ref: { namespace: "data", segments: [0] },
					},
				},
			},
		};
		expect(() => admitKaladaDefinitionWithPolicy(input, numeric, identity)).toThrow("root.value: UNATTESTED_PATH");
		Object.assign(input.root.value.expression.ref, { segments: ["0"] });
		expect(() => admitKaladaDefinitionWithPolicy(input, numeric, identity)).not.toThrow();
		const unknown = projectSchema(
			{ type: "object", additionalProperties: false, properties: { open: true } },
			{ provider: jsonSchemaProvider(), side: "input" },
		).descriptors;
		expect(() => attestProjectedInputPaths(unknown)).toThrow("Ambiguous projected node");
		const limited = projectSchema(
			{ type: "object", additionalProperties: false, properties: { name: { type: "string" } } },
			{ provider: jsonSchemaProvider(), side: "input", projectionLimits: { maxOccurrences: 1 } },
		).descriptors;
		expect(() => attestProjectedInputPaths(limited)).toThrow("Incomplete projected input authority");
	});
	it("rejects an attested but cyclic unused computation without invoking installed callbacks", () => {
		const input = definition(childNodes());
		Object.assign(input.computations[0].expression, {
			expression: {
				kind: "conditional",
				condition: { kind: "literal", value: false },
				[thenKey]: { kind: "ref", ref: { namespace: "data", segments: ["total"] } },
				else: { kind: "literal", value: "ok" },
			},
		});
		expect(() => admitKaladaDefinitionWithPolicy(input, hostPolicy(), identity)).toThrow(
			"computations[0].expression: SELF_DEPENDENCY",
		);
		expect(resolve).not.toHaveBeenCalled();
		expect(authorize).not.toHaveBeenCalled();
		expect(handler).not.toHaveBeenCalled();
	});
	it("requires an attested symbolic row and separate UI evidence", () => {
		const program = (ref: unknown) => ({
			format: "kalada-program",
			version: 1,
			profile: "kalada-v1",
			expression: { kind: "ref", ref },
		});
		const binding = { namespace: "data", segments: ["rows"] };
		const input = {
			version: 1,
			id: "row-form",
			root: {
				type: "repeater",
				id: "repeat",
				scope: "row",
				binding,
				children: [{ type: "output", id: "value", value: program({ namespace: "data", segments: [], scope: "row" }) }],
			},
		};
		const policy = hostPolicy();
		expect(admitKaladaDefinitionWithPolicy(input, policy, identity).slots[0]?.dependencies).toEqual([
			{ namespace: "data", path: ["rows", { row: "row" }] },
		]);
		const otherRow = snapshotAdmissionPolicy({
			...policy,
			schema: {
				...policy.schema,
				paths: policy.schema.paths.map((entry) =>
					entry.path.some((part) => typeof part === "object") ? { ...entry, path: ["rows", { row: "other" }] } : entry,
				),
			},
		});
		expect(() => admitKaladaDefinitionWithPolicy(input, otherRow, identity)).toThrow("UNATTESTED_PATH");
		const ui = snapshotAdmissionPolicy({
			...policy,
			namespaces: { data: "available", ui: "available" },
			ui: { availability: "complete", paths: [{ path: ["visible"], kind: "value" }] },
		});
		const uiInput = {
			version: 1,
			id: "ui-form",
			root: { type: "output", id: "output", value: program({ namespace: "ui", segments: ["visible"] }) },
		};
		expect(() => admitKaladaDefinitionWithPolicy(uiInput, policy, identity)).toThrow("MISSING_NAMESPACE_POLICY");
		expect(() => admitKaladaDefinitionWithPolicy(uiInput, ui, identity)).not.toThrow();
	});
});
