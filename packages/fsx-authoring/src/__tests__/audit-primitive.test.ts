import { type JsonValue, createFormRuntime, validateFormDefinition } from "@formbar/declarative";
import { compileDefaultKaladaV1Definition, jsonSchemaProvider, projectSchema } from "@formbar/from-schema";
import { expect, it } from "vitest";
import { compilerFixture } from "../../../../tests/consumers/fsx-authoring/fixture.js";
import { installedHost } from "../../../../tests/consumers/fsx-authoring/host.js";
import { compileFsx } from "../index.js";
import type { FsxCompileOptions } from "../types.js";
import { fixture } from "./fixture.js";

it.each(["item", "product", "outer", "inner", "primitiveItem"])(
	"admits and authorizes native/custom whole primitive %s writers",
	(scope) => {
		for (const source of [scope, ` ${scope} `, `(${scope})`, ` ( (${scope}) ) `]) {
			const { host, ports } = compilerFixture(compileFsx, scope, true, source);
			const native = host.snapshot().controls.find((control) => control.nodeId === "quantity")?.writers.value;
			expect(native?.(42).status).toBe("invalid-target");
			expect(native?.("native-item").status).toBe("applied");
			const custom = host.snapshot().controls.find((control) => control.nodeId === "row-editor")?.writers.edit;
			expect(custom?.("custom-item").status).toBe("applied");
			expect(ports.data().rows[0]).toBe("custom-item");
			const retained = host.snapshot().controls.find((control) => control.nodeId === "quantity")?.writers.value;
			ports.reorder();
			expect(retained?.("must-not-retarget").status).toBe("stale");
			const removed = host.snapshot().controls.find((control) => control.nodeId === "row-editor")?.writers.edit;
			ports.remove();
			expect(removed?.("must-not-write-removed").status).toBe("stale");
			host.dispose();
		}
	},
);

it("retains exact nested outer/inner scalar targets for native and CUSTOM", () => {
	const { options } = fixture();
	const scalar = { kind: "primitive-type" as const, name: "string" as const };
	const supplied: FsxCompileOptions = {
		...options,
		items: {
			...options.items,
			inner: { target: { namespace: "data", scope: "inner", segments: [] }, type: scalar, writable: true },
		},
		admission: {
			...options.admission,
			policy: {
				...options.admission.identity,
				namespaces: { data: "available" },
				widgets: {},
				actions: {},
				renderers: {
					"demo.editor": {
						children: "forbidden",
						props: {
							title: { modes: ["literal"], expected: "string" },
							current: { modes: ["read"], expected: "string" },
							edit: { modes: ["write"], expected: "string" },
						},
					},
				},
				schema: {
					side: "input",
					availability: "complete",
					paths: [
						{ path: ["rows"], kind: "array" },
						{ path: ["rows", { row: "outer" }, "nested"], kind: "array" },
						{ path: ["rows", { row: "outer" }, "nested", { row: "inner" }], kind: "value" },
					],
				},
				ui: { availability: "complete", paths: [] },
			},
		},
	};
	const text =
		'<Form id="nested" defaultLanguage="Kalada"><Repeater id="outer" as="outer" value={rows}><Repeater id="inner" as="inner" value={outer.nested}><Alias as="product" value={inner}><Field id="native" widget="text" value={ (product) }/><CUSTOM id="custom" renderer="Editor" title="Edit" current={product} edit={ product }/></Alias></Repeater></Repeater></Form>';
	const result = compileFsx(text, supplied);
	expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
	if (!result.ok) return;
	for (const path of [
		"root.children[0].children[0].children[0].binding",
		"root.children[0].children[0].children[1].props.edit.reference",
	])
		expect(result.validated.prepared.admitted.targets.get(path)).toEqual({
			namespace: "data",
			path: ["rows", { row: "outer" }, "nested", { row: "inner" }],
		});
});

it.each(["scope", "type", "writable"])(
	"public admission independently denies mismatched primitive %s metadata",
	(key) => {
		const { options, result, host } = compilerFixture(compileFsx, "item", true, " (item) ");
		const path = "root.children[4].children[0].binding";
		const existing = result.validated.prepared.directLocations?.[path];
		if (!existing) throw new Error("Missing compiler proof");
		const descriptor = { scope: "item", type: "string", writable: true };
		Object.defineProperty(descriptor, key, {
			value: key === "scope" ? "nonexistent" : key === "type" ? "number" : false,
		});
		const bindings = Object.assign({ ...existing }, { primitiveItem: descriptor });
		const validated = validateFormDefinition(result.definition, {
			...options.admission,
			writeSources: result.validated.prepared.writeSources,
			directLocations: { ...result.validated.prepared.directLocations, [path]: bindings },
		});
		expect(validated).toMatchObject({
			ok: false,
			diagnostics: [
				{ path: ["root", "children", 4, "children", 0, "binding"], message: "UNSUPPORTED_WRITE_TARGET_RE-AUTHOR" },
			],
		});
		host.dispose();
	},
);

it("denies empty unscoped, numeric-index, readonly and unsupported optional/computed sources", () => {
	const { options } = fixture();
	const scalar = { kind: "primitive-type" as const, name: "string" as const };
	for (const target of [
		{ namespace: "data" as const, segments: [] },
		{ namespace: "data" as const, segments: ["rows", 0] },
	]) {
		const binding = Object.defineProperty(
			{ target: { namespace: "data" as const, segments: ["name"] }, type: scalar, writable: true as const },
			"target",
			{ value: target },
		);
		expect(
			compileFsx('<Form id="f" defaultLanguage="Kalada"><Field id="x" value={value} widget="text"/></Form>', {
				...options,
				locations: { value: binding },
			}),
		).toMatchObject({ ok: false });
	}
	const readonly = Object.defineProperty(
		{ target: { namespace: "data" as const, segments: ["profile", "name"] }, type: scalar, writable: true as const },
		"writable",
		{ value: false },
	);
	expect(
		compileFsx('<Form id="f" defaultLanguage="Kalada"><Field id="x" value={value} widget="text"/></Form>', {
			...options,
			locations: { value: readonly },
		}),
	).toMatchObject({ ok: false });
	for (const expression of ["name?.x", "name + 1", "name[0]"])
		expect(
			compileFsx(
				`<Form id="f" defaultLanguage="Kalada"><Field id="x" value={${expression}} widget="text"/></Form>`,
				options,
			),
		).toMatchObject({ ok: false });
});

function record(value: JsonValue | undefined) {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected generated record");
	return value;
}

it("admits generated schema primitive native writers with the actual generated scope and independent alias", () => {
	const descriptors = projectSchema(
		{ type: "object", additionalProperties: false, properties: { rows: { type: "array", items: { type: "string" } } } },
		{ provider: jsonSchemaProvider(), side: "input" },
	).descriptors;
	const definition = compileDefaultKaladaV1Definition(descriptors);
	const children = record(definition.root).children;
	if (!Array.isArray(children)) throw new Error("Missing generated children");
	const repeater = record(children[0]);
	const scope = repeater.scope;
	if (typeof scope !== "string") throw new Error("Missing generated scope");
	const ports = installedHost(scope, true);
	const scalar = { kind: "primitive-type" as const, name: "string" as const };
	const path = "root.children[0].children[0].binding";
	const binding = {
		target: { namespace: "data" as const, scope, segments: [] },
		type: scalar,
		writable: true as const,
	};
	const bindings = Object.assign(
		{ item: binding },
		{ primitiveItem: { scope, type: "string" as const, writable: true as const } },
	);
	const validated = validateFormDefinition(definition, {
		identity: ports.identity,
		strategy: ports.strategy,
		writeSources: { [path]: " (item) " },
		directLocations: { [path]: bindings },
		policy: {
			...ports.identity,
			namespaces: { data: "available" },
			widgets: {},
			renderers: {},
			actions: {},
			schema: {
				side: "input",
				availability: "complete",
				paths: [
					{ path: ["rows"], kind: "array" },
					{ path: ["rows", { row: scope }], kind: "value" },
				],
			},
			ui: { availability: "complete", paths: [] },
		},
	});
	expect(validated).toMatchObject({ ok: true });
	if (!validated.ok) return;
	const host = createFormRuntime({ definition: validated.value });
	expect(host.snapshot().controls[0]?.writers.value?.("generated").status).toBe("applied");
	expect(ports.data().rows[0]).toBe("generated");
	host.dispose();
});
