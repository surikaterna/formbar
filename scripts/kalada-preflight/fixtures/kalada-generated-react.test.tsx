// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
import {
	compileDefaultKaladaV1Definition,
	createKaladaSchemaForm,
	jsonSchemaProvider,
	projectSchema,
} from "@formbar/from-schema";
import { KaladaFormRenderer } from "@formbar/react-schema";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { createFormRuntime, validateFormDefinition } from "../../../packages/declarative/src/index.js";
import { snapshotAdmissionPolicy } from "../../../packages/declarative/src/validators/kalada-policy.js";
import { generatedHost } from "./generated-host.js";

const schema = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	type: "object",
	properties: {
		profile: {
			type: "object",
			properties: { name: { type: "string" } },
			required: ["name"],
			additionalProperties: false,
		},
		rows: {
			type: "array",
			items: {
				type: "object",
				properties: {
					nested: {
						type: "array",
						items: {
							type: "object",
							properties: { quantity: { type: "string" } },
							required: ["quantity"],
							additionalProperties: false,
						},
					},
				},
				required: ["nested"],
				additionalProperties: false,
			},
		},
	},
	required: ["profile", "rows"],
	additionalProperties: false,
};
const provider = jsonSchemaProvider();
const projected = projectSchema(schema, { provider, side: "input" });
const generated = compileDefaultKaladaV1Definition(projected.descriptors);

function collect(
	value: unknown,
	path: string,
	fields: { path: string; binding: { scope?: string; segments: string[] }; id: string }[],
	scopes: string[],
) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return;
	const node = value as Record<string, unknown>;
	if (node.type === "repeater") scopes.push(node.scope as string);
	if (node.type === "field")
		fields.push({ path, binding: node.binding as { scope?: string; segments: string[] }, id: node.id as string });
	for (const [index, child] of ((node.children ?? []) as unknown[]).entries())
		collect(child, `${path}.children[${index}]`, fields, scopes);
}

const fields: { path: string; binding: { scope?: string; segments: string[] }; id: string }[] = [];
const scopes: string[] = [];
collect(generated.root, "root", fields, scopes);
const name = fields.find((field) => field.binding.segments.join(".") === "profile.name");
const quantity = fields.find((field) => field.binding.scope === scopes[1]);
if (!name || !quantity || scopes.length !== 2) throw new Error("incomplete generated form fixture");
const identity = { generation: "g1", fingerprint: "host" };
const policy = snapshotAdmissionPolicy({
	...identity,
	widgets: {},
	renderers: {},
	actions: {},
	namespaces: { data: "available" },
	schema: {
		side: "input",
		availability: "complete",
		paths: [
			{ path: ["profile", "name"], kind: "value" },
			{ path: ["rows"], kind: "array" },
			{ path: ["rows", { row: scopes[0] }, "nested"], kind: "array" },
			{ path: ["rows", { row: scopes[0] }, "nested", { row: scopes[1] }, "quantity"], kind: "value" },
		],
	},
	ui: { availability: "complete", paths: [] },
});
const locations = {
	[`${name.path}.binding`]: {
		profile: {
			target: { namespace: "data" as const, segments: ["profile"] },
			type: { kind: "primitive-type" as const, name: "json" as const },
			writable: true as const,
			properties: {
				name: { type: { kind: "primitive-type" as const, name: "string" as const }, writable: true as const },
			},
		},
	},
	[`${quantity.path}.binding`]: {
		line: {
			target: { namespace: "data" as const, segments: [], scope: scopes[1] },
			type: { kind: "primitive-type" as const, name: "json" as const },
			writable: true as const,
			properties: {
				quantity: { type: { kind: "primitive-type" as const, name: "string" as const }, writable: true as const },
			},
		},
	},
};
const sources = { [`${name.path}.binding`]: "profile.name", [`${quantity.path}.binding`]: "line.quantity" };

it("projects authored plain output alongside a generated FSX-compatible definition", () => {
	const root = generated.root;
	if (!root || typeof root !== "object" || Array.isArray(root) || !Array.isArray(root.children))
		throw new Error("generated fixture requires a group root");
	const candidate = {
		...generated,
		root: {
			...root,
			children: [
				...root.children,
				{
					type: "output",
					id: "computed-display",
					format: "plain",
					value: {
						format: "kalada-program",
						version: 1,
						profile: "kalada-v1",
						expression: { kind: "ref", ref: { namespace: "data", segments: ["profile", "name"] } },
					},
				},
			],
		},
	};
	const installed = generatedHost(scopes[0], scopes[1]);
	const validated = validateFormDefinition(candidate, {
		policy,
		identity,
		strategy: installed.strategy,
		writeSources: sources,
		directLocations: locations,
	});
	if (!validated.ok) throw new Error(JSON.stringify(validated.diagnostics));
	const runtime = createFormRuntime({ definition: validated.value });
	const current = installed.instances.get(validated.value.prepared.context.instance);
	if (!current) throw new Error("missing host instance");
	expect(runtime.snapshot().outputs).toMatchObject([{ nodeId: "computed-display", value: "original" }]);
	current.name = "changed";
	installed.bump(current);
	expect(runtime.snapshot().outputs[0]?.value).toBe("changed");
	runtime.dispose();
});

it("generated Kalada V1 array uses host row identity, native write, reordered display and fresh outgoing data", async () => {
	const installed = generatedHost(scopes[0], scopes[1]);
	const result = createKaladaSchemaForm(schema, {
		provider,
		side: "input",
		policy,
		identity,
		strategy: installed.strategy,
		writeSources: sources,
		directLocations: locations,
	});
	expect(JSON.stringify(result.definition)).toContain("kalada-program");
	expect(JSON.stringify(result.definition)).not.toContain('"kind":"op"');
	const original = result.host.snapshot();
	const control = original.controls.find((item) => item.nodeId === quantity.id);
	expect(control?.value).toBe("child");
	expect(control?.required).toBe(true);
	const container = document.createElement("div");
	const root = createRoot(container);
	await act(async () => root.render(<KaladaFormRenderer host={result.host} />));
	const input = container.querySelectorAll<HTMLInputElement>("input")[1];
	if (!input) throw new Error("missing generated row input");
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "edited");
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
	expect(result.host.snapshot().controls.find((item) => item.nodeId === quantity.id)?.value).toBe("edited");
	const state = installed.instances.values().next().value;
	if (!state) throw new Error("missing strategy form");
	state.rows.reverse();
	installed.bump(state);
	const moved = result.host.snapshot();
	expect(moved.controls.find((item) => item.nodeId === quantity.id)?.key).toBe(control?.key);
	expect(control?.writers.value?.("stale")).not.toEqual({ status: "applied" });
	const retained = moved.controls.find((item) => item.nodeId === quantity.id)?.writers.value;
	state.rows[1].readOnly = true;
	expect(retained?.("denied")).not.toEqual({ status: "applied" });
	state.rows[1].readOnly = false;
	state.rows[1].nested.splice(0, 1);
	installed.bump(state);
	expect(retained?.("removed")).not.toEqual({ status: "applied" });
	await act(async () =>
		container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
	);
	expect(state.outgoing).toEqual(result.host.snapshot().data);
	await act(async () => root.unmount());
	result.host.dispose();
});

it("generated V1 refuses missing host installation or a schema on the wrong side", () => {
	expect(() =>
		createKaladaSchemaForm(schema, {
			provider,
			side: "input",
			policy,
			identity,
			strategy: undefined as never,
			writeSources: sources,
			directLocations: locations,
		}),
	).toThrow(/MISSING_STRATEGY/);
	expect(() =>
		createKaladaSchemaForm(schema, {
			provider,
			side: "input",
			policy,
			identity,
			strategy: generatedHost(scopes[0], scopes[1]).strategy,
			writeSources: {},
			directLocations: locations,
		}),
	).toThrow(/MISSING_WRITER/);
	expect(() =>
		createKaladaSchemaForm(schema, {
			provider,
			side: "output",
			policy,
			identity,
			strategy: generatedHost(scopes[0], scopes[1]).strategy,
			writeSources: sources,
			directLocations: locations,
		}),
	).toThrow(/input-side schema/);
});
