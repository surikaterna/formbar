import { describe, expect, it } from "vitest";
import { generatedHost } from "../../../../scripts/kalada-preflight/fixtures/generated-host.js";
import { snapshotAdmissionPolicy } from "../../../declarative/src/validators/kalada-policy.js";
import {
	compileDefaultKaladaV1Definition,
	createKaladaSchemaForm,
	createSchemaForm,
	jsonSchemaProvider,
	projectSchema,
} from "../index.js";

const provider = jsonSchemaProvider();
interface TestNode {
	readonly id?: string;
	readonly scope?: string;
	readonly children: readonly TestNode[];
}
const schema = {
	type: "object",
	additionalProperties: false,
	properties: {
		profile: { type: "object", additionalProperties: false, properties: { name: { type: "string" } } },
		rows: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				properties: {
					nested: {
						type: "array",
						items: { type: "object", additionalProperties: false, properties: { quantity: { type: "string" } } },
					},
				},
			},
		},
	},
};

function fixture(input: unknown = schema) {
	const definition = compileDefaultKaladaV1Definition(projectSchema(input, { provider, side: "input" }).descriptors);
	const root = definition.root as unknown as TestNode;
	const name = root.children[0].children[0];
	const outer = root.children[1];
	const inner = outer.children[0].children[0];
	const quantity = inner?.children[0]?.children[0];
	if (!name?.id || !outer.scope || !inner?.scope || !quantity?.id) throw new Error("invalid nested schema fixture");
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
				{ path: ["rows", { row: outer.scope }, "nested"], kind: "array" },
				{ path: ["rows", { row: outer.scope }, "nested", { row: inner.scope }, "quantity"], kind: "value" },
			],
		},
		ui: { availability: "complete", paths: [] },
	});
	const locations = {
		"root.children[0].children[0].binding": {
			profile: {
				target: { namespace: "data" as const, segments: ["profile"] },
				type: { kind: "primitive-type" as const, name: "json" as const },
				writable: true as const,
				properties: {
					name: { type: { kind: "primitive-type" as const, name: "string" as const }, writable: true as const },
				},
			},
		},
		"root.children[1].children[0].children[0].children[0].children[0].binding": {
			line: {
				target: { namespace: "data" as const, segments: [], scope: inner.scope },
				type: { kind: "primitive-type" as const, name: "json" as const },
				writable: true as const,
				properties: {
					quantity: { type: { kind: "primitive-type" as const, name: "string" as const }, writable: true as const },
				},
			},
		},
	};
	const writeSources = {
		"root.children[0].children[0].binding": "profile.name",
		"root.children[1].children[0].children[0].children[0].children[0].binding": "line.quantity",
	};
	return {
		identity,
		policy,
		locations,
		writeSources,
		outer: outer.scope,
		inner: inner.scope,
		name: name.id,
		quantity: quantity.id,
	};
}

describe("host-backed schema form", () => {
	it("initializes projected defaults through host revision and keeps caller overrides authoritative", () => {
		const withDefault = {
			...schema,
			properties: {
				...schema.properties,
				profile: {
					...schema.properties.profile,
					properties: { name: { type: "string", default: "schema" } },
				},
			},
		};
		const proof = fixture(withDefault);
		for (const [overrides, expected] of [
			[undefined, "schema"],
			[{ profile: { name: "caller" } }, "caller"],
		] as const) {
			const installed = generatedHost(proof.outer, proof.inner);
			const result = createKaladaSchemaForm(withDefault, {
				provider,
				side: "input",
				policy: proof.policy,
				identity: proof.identity,
				strategy: installed.strategy,
				writeSources: proof.writeSources,
				directLocations: proof.locations,
				...(overrides ? { initialData: overrides } : {}),
			});
			expect(result.host.snapshot().data).toMatchObject({ profile: { name: expected } });
			result.host.dispose();
		}
	});

	it("denies submission of a typed enum violation without altering draft or revision", async () => {
		const constrained = {
			...schema,
			properties: {
				...schema.properties,
				profile: {
					...schema.properties.profile,
					properties: { name: { type: "string", enum: ["original"], "x-formbar": { widget: "radio" } } },
				},
			},
		};
		const proof = fixture(constrained);
		const installed = generatedHost(proof.outer, proof.inner);
		const result = createKaladaSchemaForm(constrained, {
			provider,
			side: "input",
			policy: proof.policy,
			identity: proof.identity,
			strategy: installed.strategy,
			writeSources: proof.writeSources,
			directLocations: proof.locations,
			installed: { widgets: new Set(["radio"]) },
		});
		expect(
			result.host
				.snapshot()
				.controls.find((item) => item.nodeId === proof.name)
				?.writers.value?.("invalid"),
		).toEqual({ status: "applied" });
		const before = result.host.snapshot();
		expect(await result.host.submit()).toEqual({ status: "denied" });
		const after = result.host.snapshot();
		expect(after.data).toEqual(before.data);
		expect(after.revision).toBe(before.revision);
		expect(after.lifecycle?.issues.schema.length).toBeGreaterThan(0);
		expect(installed.instances.values().next().value?.outgoing).toBeUndefined();
		result.host.dispose();
	});

	it("fences late async extension issues after reset and refuses overlapping submits", async () => {
		const proof = fixture();
		const installed = generatedHost(proof.outer, proof.inner);
		let release = () => {};
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		const result = createKaladaSchemaForm(schema, {
			provider,
			side: "input",
			policy: proof.policy,
			identity: proof.identity,
			strategy: installed.strategy,
			writeSources: proof.writeSources,
			directLocations: proof.locations,
			validators: [
				async () => {
					await pending;
					return [{ source: "extension", path: ["profile", "name"], message: "late" }];
				},
			],
		});
		const first = result.host.submit();
		expect(await result.host.submit()).toEqual({ status: "denied" });
		expect(result.host.reset()).toMatchObject({ ok: true });
		const revision = result.host.snapshot().revision;
		release();
		expect(await first).toEqual({ status: "denied" });
		expect(result.host.snapshot()).toMatchObject({ revision, lifecycle: { issues: { extension: [] } } });
		expect(installed.instances.values().next().value?.outgoing).toBeUndefined();
		result.host.dispose();
	});
	it("generates an input field with an installed default widget, initial host data and renderer metadata", () => {
		const proof = fixture();
		const installed = generatedHost(proof.outer, proof.inner);
		const result = createKaladaSchemaForm(schema, {
			provider,
			side: "input",
			policy: proof.policy,
			identity: proof.identity,
			strategy: installed.strategy,
			writeSources: proof.writeSources,
			directLocations: proof.locations,
		});
		const name = result.host.snapshot().controls.find((item) => item.nodeId === proof.name);
		expect(name).toMatchObject({ value: "original", rendererId: "text" });
		expect(name?.writers.value?.("changed")).toEqual({ status: "applied" });
		expect(result.host.snapshot().data).toMatchObject({ profile: { name: "changed" } });
		result.host.dispose();
	});

	it("keeps typed enum choices and explicit presentation on an installed generated control", () => {
		const withChoices = {
			...schema,
			properties: {
				...schema.properties,
				profile: {
					...schema.properties.profile,
					properties: {
						name: {
							type: "string",
							enum: ["original", "changed"],
							title: "Profile name",
							"x-formbar": { widget: "radio", placeholder: "Choose", span: 6 },
						},
					},
				},
			},
		};
		const proof = fixture(withChoices);
		const installed = generatedHost(proof.outer, proof.inner);
		const result = createKaladaSchemaForm(withChoices, {
			provider,
			side: "input",
			policy: proof.policy,
			identity: proof.identity,
			strategy: installed.strategy,
			writeSources: proof.writeSources,
			directLocations: proof.locations,
			installed: { widgets: new Set(["radio"]) },
		});
		const field = (result.definition.root as { children: { children: unknown[] }[] }).children[0].children[0];
		expect(field).toMatchObject({
			widget: "radio",
			label: "Profile name",
			presentation: { span: 6 },
			props: {
				placeholder: { mode: "literal", value: "Choose" },
				options: {
					mode: "literal",
					value: [
						{ value: "original", title: "original" },
						{ value: "changed", title: "changed" },
					],
				},
			},
		});
		expect(result.host.snapshot().controls.find((item) => item.nodeId === proof.name)?.value).toBe("original");
		result.host.dispose();
	});

	it.each([
		["string", ["0", ""], "0"],
		["integer", [0, 1], 0],
		["boolean", [false, true], false],
	] as const)("keeps %s choices typed and submits string choices without coercion", async (type, values, selected) => {
		const constrained = {
			...schema,
			properties: {
				...schema.properties,
				profile: {
					...schema.properties.profile,
					properties: { name: { type, enum: values } },
				},
			},
		};
		const proof = fixture(constrained);
		const installed = generatedHost(proof.outer, proof.inner);
		const result = createKaladaSchemaForm(constrained, {
			provider,
			side: "input",
			policy: proof.policy,
			identity: proof.identity,
			strategy: installed.strategy,
			writeSources: proof.writeSources,
			directLocations: proof.locations,
		});
		const field = (result.definition.root as { children: { children: unknown[] }[] }).children[0].children[0];
		expect(field).toMatchObject({
			widget: "select",
			props: { options: { value: values.map((value) => ({ value, title: String(value) })) } },
		});
		// This installed fixture writes only strings; non-string choices are checked at generation, not coerced by the host.
		if (type === "string") {
			const writer = result.host.snapshot().controls.find((item) => item.nodeId === proof.name)?.writers.value;
			expect(writer?.(selected)).toEqual({ status: "applied" });
			expect(await result.host.submit()).toEqual({ status: "submitted" });
			expect(installed.instances.values().next().value?.outgoing).toEqual(result.host.snapshot().data);
		}
		result.host.dispose();
	});

	it("decorates matching typed enum values without converting 0 into '0' or false into null", () => {
		const constrained = {
			...schema,
			properties: {
				...schema.properties,
				profile: {
					...schema.properties.profile,
					properties: {
						name: {
							type: "integer",
							enum: [0, 1],
							"x-formbar": {
								options: [
									{ value: "0", title: "Wrong" },
									{ value: 0, title: "Zero", disabled: true },
								],
							},
						},
					},
				},
			},
		};
		const proof = fixture(constrained);
		const result = createKaladaSchemaForm(constrained, {
			provider,
			side: "input",
			policy: proof.policy,
			identity: proof.identity,
			strategy: generatedHost(proof.outer, proof.inner).strategy,
			writeSources: proof.writeSources,
			directLocations: proof.locations,
		});
		const field = (result.definition.root as { children: { children: unknown[] }[] }).children[0].children[0];
		expect(field).toMatchObject({
			props: {
				options: {
					value: [
						{ value: 0, title: "Zero", disabled: true },
						{ value: 1, title: "1" },
					],
				},
			},
		});
		result.host.dispose();
	});

	it("writes nested rows through stable host identity, rejects stale writers and submits fresh data", async () => {
		const proof = fixture();
		const installed = generatedHost(proof.outer, proof.inner);
		const result = createKaladaSchemaForm(schema, {
			provider,
			side: "input",
			policy: proof.policy,
			identity: proof.identity,
			strategy: installed.strategy,
			writeSources: proof.writeSources,
			directLocations: proof.locations,
		});
		const original = result.host.snapshot().controls.find((item) => item.nodeId === proof.quantity);
		expect(original?.value).toBe("child");
		expect(original?.writers.value?.("edited")).toEqual({ status: "applied" });
		const state = installed.instances.values().next().value;
		if (!state) throw new Error("missing host state");
		expect(state.rows[0].nested[0].quantity).toBe("edited");
		state.rows.reverse();
		installed.bump(state);
		const moved = result.host.snapshot().controls.find((item) => item.nodeId === proof.quantity);
		expect(moved?.key).toBe(original?.key);
		expect(original?.writers.value?.("stale")).not.toEqual({ status: "applied" });
		expect(await result.host.submit()).toEqual({ status: "submitted" });
		expect(state.outgoing).toEqual(result.host.snapshot().data);
		result.host.dispose();
	});

	it("fails closed for legacy calls, wrong side, absent or mismatched host write proof", () => {
		const proof = fixture();
		const migration =
			"createSchemaForm is no longer supported; migrate to createKaladaSchemaForm with host policy, identity, strategy and direct write locations.";
		for (const options of [
			{ provider, side: "input" },
			{ provider, side: "output", definition: { version: 1, id: "legacy", root: {} } },
			{ provider, side: "input", validators: [() => []], submission: { policy: "omit-inactive" } },
		])
			expect(() => createSchemaForm(schema, options)).toThrow(migration);
		const options = {
			provider,
			side: "input" as const,
			policy: proof.policy,
			identity: proof.identity,
			strategy: generatedHost(proof.outer, proof.inner).strategy,
			directLocations: proof.locations,
			writeSources: proof.writeSources,
		};
		expect(() => createKaladaSchemaForm(schema, { ...options, side: "output" })).toThrow(/input-side/);
		expect(() => createKaladaSchemaForm(schema, { ...options, writeSources: {} })).toThrow(/MISSING_WRITER/);
		expect(() => createKaladaSchemaForm(schema, { ...options, directLocations: {} })).toThrow(
			/UNSUPPORTED_WRITE_TARGET/,
		);
		expect(() => createKaladaSchemaForm(schema, { ...options, strategy: undefined as never })).toThrow(
			/MISSING_STRATEGY/,
		);
		expect(() =>
			createKaladaSchemaForm(schema, {
				...options,
				policy: { ...proof.policy, fingerprint: "another-host" },
			}),
		).toThrow();
	});
});
