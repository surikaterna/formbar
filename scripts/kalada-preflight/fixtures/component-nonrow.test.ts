import { expect, it } from "vitest";
import type { TrustedDirectLocations } from "../../../packages/declarative/src/validators/kalada-direct-location.js";
import { snapshotAdmissionPolicy } from "../../../packages/declarative/src/validators/kalada-policy.js";
import { createPrivateKaladaRuntime } from "../../../packages/declarative/src/validators/kalada-private-runtime.js";
import { directWriteServer } from "./direct-write-server.js";

const identity = { generation: "g1", fingerprint: "host" };
const target = { namespace: "data" as const, segments: ["order", "total"] };
const program = {
	format: "kalada-program",
	version: 1,
	profile: "kalada-v1",
	expression: { kind: "ref", ref: target },
};
const definition = {
	version: 1,
	id: "custom",
	root: {
		type: "custom",
		id: "editor",
		renderer: "demo.editor",
		props: { display: { mode: "read", expression: program }, edit: { mode: "write", reference: target } },
	},
};
const path = "root.props.edit.reference";
const policy = snapshotAdmissionPolicy({
	...identity,
	widgets: {},
	actions: {},
	namespaces: { data: "available" },
	renderers: {
		"demo.editor": {
			children: "forbidden",
			props: {
				display: { modes: ["read"], expected: "number" },
				edit: { modes: ["write"], expected: "number" },
			},
		},
	},
	schema: { side: "input", availability: "complete", paths: [{ path: target.segments, kind: "value" }] },
	ui: { availability: "complete", paths: [] },
});
const location = {
	order: {
		target: { namespace: "data" as const, segments: ["order"] },
		type: { kind: "primitive-type" as const, name: "json" as const },
		writable: true as const,
		properties: {
			total: { type: { kind: "primitive-type" as const, name: "number" as const }, writable: true as const },
		},
	},
};

it("nonrow custom is a WRITE-context target, not a field binding or computed inverse", () => {
	const host = directWriteServer();
	const runtime = createPrivateKaladaRuntime({
		definition,
		policy,
		identity,
		strategy: host.strategy,
		directLocations: { [path]: location },
	});
	const prop = runtime.projectCustom("root", { rows: [] }, undefined, { edit: "order.total" });
	expect(prop.display).toBe(4);
	const edit = prop.edit as { value: number; onChange: (value: unknown) => { status: string } };
	expect(edit.value).toBe(4);
	expect(edit.onChange(11)).toEqual({ status: "applied" });
	expect(host.state().submitted).toEqual({ order: { total: 11 }, untouched: "retained" });
	expect(runtime.projectCustom("root", { rows: [] }, undefined, { edit: "order.total" }).display).toBe(11);
	expect(edit.onChange(9)).not.toEqual({ status: "applied" });
	expect(host.requests).toHaveLength(1);
	runtime.dispose();
});

it("rejects wrong source, missing writer, wrong type/readonly metadata and unknown custom/prop", () => {
	const host = directWriteServer();
	const install = (locations: TrustedDirectLocations[string] = location) =>
		createPrivateKaladaRuntime({
			definition,
			policy,
			identity,
			strategy: host.strategy,
			directLocations: { [path]: locations },
		});
	const runtime = install();
	const project = (id: string, source?: string) =>
		runtime.projectCustom(id, { rows: [] }, undefined, source ? { edit: source } : {});
	expect(() => project("root", "order.total + 1")).toThrow(/root.props.edit.reference: INVALID_WRITE_TARGET/);
	expect(() => project("root")).toThrow(/root.props.edit.reference: MISSING_WRITER/);
	expect(() => project("root.props.unknown", "order.total")).toThrow(/UNKNOWN_CUSTOM/);
	const wrongType = install({
		order: {
			...location.order,
			properties: {
				total: {
					...location.order.properties.total,
					type: { kind: "primitive-type", name: "string" },
				},
			},
		},
	});
	expect(() => wrongType.projectCustom("root", { rows: [] }, undefined, { edit: "order.total" })).toThrow(
		/INVALID_WRITE_TARGET/,
	);
	const readonly = install({
		order: {
			...location.order,
			properties: {
				total: {
					...location.order.properties.total,
					writable: false,
				},
			},
		},
	} as unknown as TrustedDirectLocations[string]);
	expect(() => readonly.projectCustom("root", { rows: [] }, undefined, { edit: "order.total" })).toThrow(
		/INVALID_WRITE_TARGET/,
	);
	expect(host.requests).toHaveLength(0);
	runtime.dispose();
	wrongType.dispose();
	readonly.dispose();
});

it("rejects computed expression in WRITE slot and denies disabled callbacks without touching the host", () => {
	const host = directWriteServer();
	const disabled = {
		...definition,
		root: { ...definition.root, disabled: { ...program, expression: { kind: "literal", value: true } } },
	};
	const runtime = createPrivateKaladaRuntime({
		definition: disabled,
		policy,
		identity,
		strategy: host.strategy,
		directLocations: { [path]: location },
	});
	const edit = runtime.projectCustom("root", { rows: [] }, undefined, { edit: "order.total" }).edit as {
		onChange: (value: unknown) => { status: string };
	};
	expect(edit.onChange(10)).toEqual({ status: "denied" });
	expect(host.requests).toHaveLength(0);
	expect(() =>
		createPrivateKaladaRuntime({
			definition: {
				...definition,
				root: { ...definition.root, props: { ...definition.root.props, edit: { mode: "write", expression: program } } },
			},
			policy,
			identity,
			strategy: host.strategy,
		}),
	).toThrow(/root.props.edit.expression: UNKNOWN_KEY/);
	runtime.dispose();
});

it("non-JSON and mismatched computed READ results fail instead of leaking into component props", () => {
	const host = directWriteServer();
	for (const value of [() => 1, "not a number"]) {
		const strategy = {
			...host.strategy,
			capture(context: Parameters<typeof host.strategy.capture>[0]) {
				const frame = host.strategy.capture(context);
				return { ...frame, read: () => ({ status: "found" as const, value: value as never }) };
			},
		};
		const runtime = createPrivateKaladaRuntime({
			definition,
			policy,
			identity,
			strategy,
			directLocations: { [path]: location },
		});
		expect(() => runtime.projectCustom("root", { rows: [] }, undefined, { edit: "order.total" })).toThrow(
			/root.props.display.expression:/,
		);
		runtime.dispose();
	}
	expect(host.requests).toHaveLength(0);
});

it("rejects absent, cross-instance and unbounded host whole-data snapshots without submitting", async () => {
	const host = directWriteServer();
	const bare = createPrivateKaladaRuntime({ definition, policy, identity, strategy: host.strategy });
	expect(bare.captureSubmission()).toEqual({ status: "unsupported" });
	expect(await bare.submit()).toEqual({ status: "unsupported" });
	bare.dispose();
	for (const captureSubmission of [
		() => ({ status: "found" as const, instance: {}, revision: host.state().revision, data: { order: { total: 4 } } }),
		(context: { instance: object }) => ({
			status: "found" as const,
			instance: context.instance,
			revision: host.state().revision,
			data: Array(1025).fill(0),
		}),
	]) {
		const runtime = createPrivateKaladaRuntime({
			definition,
			policy,
			identity,
			strategy: {
				...host.strategy,
				captureSubmission,
				submitCaptured: () => {
					throw new Error("submit must never be called");
				},
			},
		});
		expect(runtime.captureSubmission()).toEqual({ status: "stale" });
		expect(await runtime.submit()).toEqual({ status: "stale" });
		runtime.dispose();
	}
	expect(host.requests).toHaveLength(0);
});

it("nonrow native requires installed static WRITE evidence at bind and invoke, independent of permissive host", () => {
	const nativeDefinition = {
		...definition,
		root: { type: "field", id: "editor", widget: "demo.number", binding: target },
	};
	const nativePolicy = snapshotAdmissionPolicy({
		...identity,
		widgets: { "demo.number": { children: "forbidden", props: {} } },
		renderers: {},
		actions: {},
		namespaces: { data: "available" },
		schema: { side: "input", availability: "complete", paths: [{ path: target.segments, kind: "value" }] },
		ui: { availability: "complete", paths: [] },
	});
	const host = directWriteServer();
	const baseline = JSON.stringify(host.state().submitted);
	const nativePath = "root.binding";
	const install = (locations?: TrustedDirectLocations, data = nativeDefinition, strategy = host.strategy) =>
		createPrivateKaladaRuntime({
			definition: data,
			policy: nativePolicy,
			identity,
			strategy,
			...(locations ? { directLocations: locations } : {}),
		});
	const valid = { [nativePath]: location };
	const missing = install();
	const wrong = install(valid);
	const readonly = install({
		[nativePath]: {
			order: { ...location.order, properties: { total: { ...location.order.properties.total, writable: false } } },
		},
	} as unknown as TrustedDirectLocations);
	for (const [runtime, source] of [
		[missing, "order.total"],
		[wrong, "order.total + 1"],
		[readonly, "order.total"],
	] as const) {
		expect(() => runtime.projectNative(nativePath, { rows: [] }, undefined, source)).toThrow();
		runtime.dispose();
	}
	const computed = install(valid, {
		...nativeDefinition,
		computations: [{ id: "computed", target, expression: { ...program, expression: { kind: "literal", value: 4 } } }],
	} as typeof nativeDefinition);
	expect(() => computed.projectNative(nativePath, { rows: [] }, undefined, "order.total")).toThrow();
	computed.dispose();
	expect(host.requests).toHaveLength(0);
	expect(host.state().notices).toBe(0);
	expect(JSON.stringify(host.state().submitted)).toBe(baseline);
	const positiveHost = directWriteServer();
	const permitted = install(valid, nativeDefinition, positiveHost.strategy);
	expect(() => permitted.projectNative(nativePath)).toThrow(/MISSING_WRITER/);
	const binding = permitted.projectNative(nativePath, { rows: [] }, undefined, "order.total");
	expect(binding.value).toBe(4);
	expect(binding.onChange(12)).toEqual({ status: "applied" });
	expect(binding.onChange(13)).not.toEqual({ status: "applied" });
	expect(positiveHost.requests).toHaveLength(1);
	permitted.dispose();
});
