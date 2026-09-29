// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
import * as React from "react";
import { act, useEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { TrustedDirectLocations } from "../../../packages/declarative/src/validators/kalada-direct-location.js";
import { snapshotAdmissionPolicy } from "../../../packages/declarative/src/validators/kalada-policy.js";
import { createPrivateKaladaRuntime } from "../../../packages/declarative/src/validators/kalada-private-runtime.js";
import { normalizeExtensions, resolveCustomNode } from "../../../packages/react-schema/src/extension-registry.js";
import type { RendererContext, WidgetProps } from "../../../packages/react-schema/src/extension-types.js";
import { quantityPath, referencePath, serialHost, versionedHost } from "./row-write-hosts.js";

const identity = { generation: "g1", fingerprint: "host" };
const ref = (segments: string[], scope?: string) => ({
	namespace: "data" as const,
	segments,
	...(scope ? { scope } : {}),
});
const program = (expression: unknown) => ({ format: "kalada-program", version: 1, profile: "kalada-v1", expression });
const customPath = "root.children[0].children[0]";
const nativePath = "root.children[0].children[1]";
const customWrite = `${customPath}.props.edit.reference`;
const nativeWrite = `${nativePath}.binding`;
const definition = {
	version: 1,
	id: "bridge",
	root: {
		type: "repeater",
		id: "outer",
		scope: "outer",
		binding: ref(["rows"]),
		children: [
			{
				type: "repeater",
				id: "inner",
				scope: "inner",
				binding: ref(["nested"], "outer"),
				children: [
					{
						type: "custom",
						id: "custom",
						renderer: "demo.editor",
						disabled: program({ kind: "literal", value: false }),
						props: {
							current: { mode: "read", expression: program({ kind: "ref", ref: ref(["quantity"], "inner") }) },
							edit: { mode: "write", reference: ref(["quantity"], "inner") },
							tone: { mode: "literal", value: "safe" },
						},
					},
					{ type: "field", id: "native", widget: "demo.text", binding: ref(["quantity"], "inner") },
				],
			},
		],
	},
};
const policy = snapshotAdmissionPolicy({
	...identity,
	widgets: { "demo.text": { children: "forbidden", props: {} } },
	renderers: {
		"demo.editor": {
			children: "forbidden",
			props: {
				current: { modes: ["read"], expected: "string" },
				edit: { modes: ["write"], expected: "string" },
				tone: { modes: ["literal"], expected: "string" },
			},
		},
	},
	actions: {},
	namespaces: { data: "available" },
	schema: {
		side: "input",
		availability: "complete",
		paths: [
			{ path: ["rows"], kind: "array" },
			{ path: ["rows", { row: "outer" }, "nested"], kind: "array" },
			{ path: quantityPath, kind: "value" },
			{ path: referencePath, kind: "value" },
		],
	},
	ui: { availability: "complete", paths: [] },
});
const location = {
	line: {
		target: ref([], "inner"),
		type: { kind: "primitive-type" as const, name: "json" as const },
		writable: true as const,
		properties: {
			quantity: { type: { kind: "primitive-type" as const, name: "string" as const }, writable: true as const },
		},
	},
};
const directLocations = { [customWrite]: location, [nativeWrite]: location };
type Host = ReturnType<typeof serialHost> | ReturnType<typeof versionedHost>;
type Runtime = ReturnType<typeof createPrivateKaladaRuntime>;
const retained: ((value: unknown) => { status: string })[] = [];
const registry = normalizeExtensions({
	nodes: [
		{
			id: "demo.editor",
			component: (props: RendererContext) => {
				// Test-only ephemeral channel: deliberately NOT ExtensionProps or a serialized definition.
				const projection = props.props as unknown as {
					current: string;
					tone: string;
					edit: { value: string; onChange: (value: unknown) => { status: string } };
				};
				retained.push(projection.edit.onChange);
				return (
					<section data-current={projection.current} data-tone={projection.tone}>
						<input
							data-custom
							value={projection.edit.value}
							onChange={(event) => projection.edit.onChange(event.currentTarget.value)}
						/>
					</section>
				);
			},
		},
	],
	widgets: [
		{
			id: "demo.text",
			component: (props: WidgetProps) => (
				<input
					data-native
					value={String(props.value)}
					onChange={(event) => props.onChange(event.currentTarget.value)}
				/>
			),
		},
	],
});

function TestRenderer({ runtime }: { runtime: Runtime }) {
	useSyncExternalStore(runtime.subscribe, runtime.currentRevision, () => undefined);
	useEffect(() => () => runtime.dispose(), [runtime]);
	const outer = runtime.capture().enumerateRows("root");
	if (!outer.ok) throw new Error(outer.code);
	const first = outer.rows[0];
	if (!first) throw new Error("missing outer");
	const inner = runtime.capture().enumerateRows("root.children[0]", first.scope);
	if (!inner.ok) throw new Error(inner.code);
	const row = inner.rows[0];
	if (!row) throw new Error("missing inner");
	const projected = runtime.projectCustom(customPath, row.scope, row, { edit: "line.quantity" });
	const native = runtime.projectNative(nativeWrite, row.scope, row, "line.quantity");
	const custom = registry.nodes.get("demo.editor");
	const widget = registry.widgets.get("demo.text");
	if (!custom || !widget) throw new Error("unregistered renderer");
	const Custom = custom.component;
	const Widget = widget.component;
	return (
		<div>
			<Custom
				nodeId="custom"
				instanceKey="row"
				renderer="demo.editor"
				props={projected as RendererContext["props"]}
				policy={{ visible: true, disabled: false, readOnly: false }}
			>
				{null}
			</Custom>
			<Widget
				nodeId="native"
				instanceKey="row"
				widget="demo.text"
				binding={{ namespace: "data", segments: ["quantity"], path: nativeWrite }}
				value={native.value}
				props={{}}
				constraints={{}}
				options={[]}
				metadata={{ label: "native" }}
				policy={{ visible: true, disabled: false, readOnly: false, required: false }}
				issues={[]}
				valid
				validating={false}
				touched={false}
				dirty={false}
				a11y={{
					controlId: "native",
					labelId: "native-label",
					errorId: "native-error",
					invalid: false,
					required: false,
					busy: false,
				}}
				onChange={(value) => {
					if (native.onChange(value).status !== "applied") throw new Error("native rejected");
				}}
				onBlur={() => {}}
			/>
		</div>
	);
}

function mount(host: Host) {
	const runtime = createPrivateKaladaRuntime({
		definition,
		policy,
		identity,
		strategy: host.strategy,
		directLocations,
	});
	const instance = [...host.states.keys()].at(-1) as object;
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	act(() => root.render(<TestRenderer runtime={runtime} />));
	return {
		runtime,
		instance,
		container,
		unmount: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
}

for (const [name, factory] of [
	["mutable tree", serialHost],
	["versioned registry", versionedHost],
] as const) {
	it(`${name}: retained row writers revalidate live trusted WRITE descriptors before contacting host`, () => {
		for (const path of [customWrite, nativeWrite]) {
			const host = factory();
			const metadata: Record<string, TrustedDirectLocations[string]> = {
				[customWrite]: structuredClone(location),
				[nativeWrite]: structuredClone(location),
			};
			const runtime = createPrivateKaladaRuntime({
				definition,
				policy,
				identity,
				strategy: host.strategy,
				directLocations: metadata,
			});
			const instance = [...host.states.keys()][0] as object;
			const outer = runtime.capture().enumerateRows("root");
			if (!outer.ok || !outer.rows[0]) throw new Error("missing outer");
			const inner = runtime.capture().enumerateRows("root.children[0]", outer.rows[0].scope);
			if (!inner.ok || !inner.rows[0]) throw new Error("missing inner");
			const row = inner.rows[0];
			const bind = () =>
				path === customWrite
					? (
							runtime.projectCustom(customPath, row.scope, row, { edit: "line.quantity" }).edit as {
								onChange: (value: unknown) => { status: string };
							}
						).onChange
					: runtime.projectNative(nativeWrite, row.scope, row, "line.quantity").onChange;
			const write = bind();
			const requests = vi.spyOn(host.strategy, "writeDirect");
			if (path === customWrite)
				expect(() => runtime.projectCustom(customPath, row.scope, row, { edit: "line.quantity + 1" })).toThrow(
					/INVALID_WRITE_TARGET/,
				);
			else
				expect(() => runtime.projectNative(nativeWrite, row.scope, row, "line.quantity + 1")).toThrow(
					/INVALID_WRITE_TARGET/,
				);
			const initial = runtime.captureSubmission();
			if (initial.status !== "found") throw new Error("missing submission");
			const initialData = JSON.stringify(initial.request.data);
			const revision = host.strategy.current({ instance, policyGeneration: "g1", policyFingerprint: "host" });
			const notices = host.notifications.mock.calls.length;
			const assertNoWrite = () => {
				expect(requests).not.toHaveBeenCalled();
				expect(host.submissions).toHaveLength(0);
				expect(host.notifications).toHaveBeenCalledTimes(notices);
				expect(host.strategy.current({ instance, policyGeneration: "g1", policyFingerprint: "host" })).toBe(revision);
				expect(runtime.captureSubmission()).toEqual(initial);
				expect(JSON.stringify(initial.request.data)).toBe(initialData);
				const state = host.states.get(instance);
				if (!state) throw new Error("missing state");
				const child = "version" in state ? state.version.nodes.get("child") : state.roots[0]?.children[0];
				expect(child?.token).toBe(row.token);
				expect(child?.quantity).toBe("child-quantity");
			};
			// Mutation of a nested descriptor and replacement of the containing binding are distinct revocations.
			(
				metadata[path] as unknown as { line: { properties: { quantity: { writable: boolean } } } }
			).line.properties.quantity.writable = false;
			expect(write("revoked-nested")).toEqual({ status: "invalid-target" });
			assertNoWrite();
			metadata[path] = {
				...location,
				line: { ...location.line, writable: false },
			} as unknown as TrustedDirectLocations[string];
			expect(write("revoked-parent")).toEqual({ status: "invalid-target" });
			assertNoWrite();
			metadata[path] = { line: { ...location.line, target: ref([], "outer") } };
			expect(write("mismatched-scope")).toEqual({ status: "invalid-target" });
			assertNoWrite();
			delete metadata[path];
			expect(write("missing-binding")).toEqual({ status: "invalid-target" });
			assertNoWrite();
			metadata[path] = structuredClone(location);
			expect(write("permitted")).toEqual({ status: "applied" });
			expect(requests).toHaveBeenCalledTimes(1);
			expect(write("retained-stale")).not.toEqual({ status: "applied" });
			expect(requests).toHaveBeenCalledTimes(1);
			const state = host.states.get(instance);
			if (!state) throw new Error("missing state");
			if ("version" in state) {
				if (!("change" in host)) throw new Error("invalid host");
				host.change(instance, (draft) => draft.roots.reverse());
			} else {
				if (!("bump" in host)) throw new Error("invalid host");
				state.roots.reverse();
				host.bump(state);
			}
			const reordered = runtime.captureSubmission();
			const reorderedNotices = host.notifications.mock.calls.length;
			expect(write("reordered-stale")).not.toEqual({ status: "applied" });
			expect(requests).toHaveBeenCalledTimes(1);
			expect(runtime.captureSubmission()).toEqual(reordered);
			expect(host.notifications).toHaveBeenCalledTimes(reorderedNotices);
			if ("version" in state) {
				if (!("change" in host)) throw new Error("invalid host");
				host.change(instance, (draft) => {
					const parent = draft.nodes.get("first");
					if (parent) parent.children = [];
				});
			} else {
				if (!("bump" in host)) throw new Error("invalid host");
				const parent = state.roots.find((item) => item.id === "first");
				if (parent) parent.children = [];
				host.bump(state);
			}
			const removed = runtime.captureSubmission();
			const removedNotices = host.notifications.mock.calls.length;
			expect(write("removed-stale")).not.toEqual({ status: "applied" });
			expect(requests).toHaveBeenCalledTimes(1);
			expect(runtime.captureSubmission()).toEqual(removed);
			expect(host.notifications).toHaveBeenCalledTimes(removedNotices);
			runtime.dispose();
		}
	});

	it(`${name}: computed row targets cannot be bound as WRITE sources`, () => {
		const host = factory();
		const requests = vi.spyOn(host.strategy, "writeDirect");
		expect(() =>
			createPrivateKaladaRuntime({
				definition: {
					...definition,
					computations: [
						{
							id: "derived",
							target: ref(["quantity"], "inner"),
							expression: program({ kind: "literal", value: "derived" }),
						},
					],
				},
				policy,
				identity,
				strategy: host.strategy,
				directLocations,
			}),
		).toThrow(/computations\[0\].target: INVALID_BINDING/);
		expect(requests).not.toHaveBeenCalled();
		expect(host.submissions).toHaveLength(0);
		expect(host.notifications).not.toHaveBeenCalled();
	});
	it(`${name}: installed custom and native components share strategy data, revision and host submission`, async () => {
		retained.length = 0;
		const host = factory();
		const a = mount(host);
		const b = mount(host);
		expect(a.container.querySelector("section")?.getAttribute("data-current")).toBe("child-quantity");
		expect(a.container.querySelector("section")?.getAttribute("data-tone")).toBe("safe");
		expect(a.container.querySelector<HTMLInputElement>("[data-native]")?.value).toBe("child-quantity");
		const old = retained[0];
		expect(old).toBeTypeOf("function");
		expect(JSON.stringify(definition)).not.toContain("onChange");
		act(() => {
			expect(old?.("custom-write")).toEqual({ status: "applied" });
		});
		expect(a.container.querySelector("section")?.getAttribute("data-current")).toBe("custom-write");
		expect(a.container.querySelector<HTMLInputElement>("[data-native]")?.value).toBe("custom-write");
		expect(b.container.querySelector("section")?.getAttribute("data-current")).toBe("child-quantity");
		expect(old?.("stale")).not.toEqual({ status: "applied" });
		const input = a.container.querySelector<HTMLInputElement>("[data-native]");
		act(() => {
			if (!input) throw new Error("missing native");
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "native-write");
			input.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(await a.runtime.submit()).toEqual({ status: "submitted" });
		expect(host.submissions[0]).toEqual(
			expect.objectContaining({
				rows: expect.arrayContaining([
					expect.objectContaining({
						nested: expect.arrayContaining([expect.objectContaining({ quantity: "native-write" })]),
					}),
				]),
			}),
		);
		expect(
			resolveCustomNode(registry, "demo.editor", definition.root.children[0].children[0].props as never),
		).toMatchObject({ ok: false, code: "invalid-extension-props" });
		a.unmount();
		b.unmount();
	});

	it(`${name}: detached whole-data submission is instance/revision bound across handoff and disposal`, async () => {
		const host = factory();
		const runtime = createPrivateKaladaRuntime({
			definition,
			policy,
			identity,
			strategy: host.strategy,
			directLocations,
		});
		const instance = [...host.states.keys()][0] as object;
		const captured = runtime.captureSubmission();
		expect(captured.status).toBe("found");
		if (captured.status !== "found") throw new Error("no capture");
		expect(captured.request.instance).toBe(instance);
		expect(Object.isFrozen(captured.request.data)).toBe(true);
		const initial = JSON.stringify(captured.request.data);
		const outer = runtime.capture().enumerateRows("root");
		if (!outer.ok || !outer.rows[0]) throw new Error("no row");
		const inner = runtime.capture().enumerateRows("root.children[0]", outer.rows[0].scope);
		if (!inner.ok || !inner.rows[0]) throw new Error("no child");
		const prop = runtime.projectCustom(customPath, inner.rows[0].scope, inner.rows[0], { edit: "line.quantity" });
		const edit = prop.edit as { onChange: (value: unknown) => { status: string } };
		expect(edit.onChange("submitted-value")).toEqual({ status: "applied" });
		expect(JSON.stringify(captured.request.data)).toBe(initial);
		expect(await runtime.submit()).toEqual({ status: "submitted" });
		expect(JSON.stringify(host.submissions[0])).toContain("submitted-value");
		const state = host.states.get(instance);
		if (!state) throw new Error("missing host");
		const field = "version" in state ? state.version.field : state.field;
		field.denied = true;
		expect(runtime.captureSubmission()).toEqual({ status: "denied" });
		expect(await runtime.submit()).toEqual({ status: "denied" });
		field.denied = false;
		field.missing = true;
		expect(await runtime.submit()).toEqual({ status: "missing" });
		field.missing = false;
		let release: (() => void) | undefined;
		host.setHandoff(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		const attempt = runtime.submit();
		field.readOnly = true;
		release?.();
		expect(await attempt).toEqual({ status: "denied" });
		expect(host.submissions).toHaveLength(1);
		field.readOnly = false;
		const disposedAttempt = runtime.submit();
		runtime.dispose();
		release?.();
		expect(await disposedAttempt).toEqual({ status: "stale" });
		expect(await runtime.submit()).toEqual({ status: "stale" });
		expect(host.submissions).toHaveLength(1);
	});

	it(`${name}: retained custom writer never retargets after reorder/removal/replacement or grant change`, () => {
		const host = factory();
		const runtime = createPrivateKaladaRuntime({
			definition,
			policy,
			identity,
			strategy: host.strategy,
			directLocations,
		});
		const instance = [...host.states.keys()][0] as object;
		const getRow = () => {
			const outer = runtime.capture().enumerateRows("root");
			if (!outer.ok) throw new Error("outer unavailable");
			const withChild = outer.rows.find((item) => {
				const inner = runtime.capture().enumerateRows("root.children[0]", item.scope);
				return inner.ok && inner.rows.length > 0;
			});
			if (!withChild) throw new Error("child unavailable");
			const inner = runtime.capture().enumerateRows("root.children[0]", withChild.scope);
			if (!inner.ok || !inner.rows[0]) throw new Error("child unavailable");
			return inner.rows[0];
		};
		const bind = () =>
			(
				runtime.projectCustom(customPath, getRow().scope, getRow(), {
					edit: "line.quantity",
				}).edit as { onChange: (value: unknown) => { status: string } }
			).onChange;
		const original = bind();
		const state = host.states.get(instance);
		if (!state) throw new Error("missing state");
		if ("version" in state) {
			if (!("change" in host)) throw new Error("invalid host");
			host.change(instance, (draft) => {
				draft.roots.reverse();
			});
		} else {
			if (!("bump" in host)) throw new Error("invalid host");
			state.roots.reverse();
			host.bump(state);
		}
		expect(original("reordered-stale")).not.toEqual({ status: "applied" });
		const afterReorder = bind();
		expect(afterReorder("reordered-live")).toEqual({ status: "applied" });
		expect(original("stale-again")).not.toEqual({ status: "applied" });
		const afterWrite = bind();
		if ("version" in state) {
			const child = state.version.nodes.get("child");
			if (!child) throw new Error("missing child");
			child.denied = true;
		} else {
			const child = state.roots[1]?.children[0];
			if (!child) throw new Error("missing child");
			child.denied = true;
		}
		expect(afterWrite("denied")).toEqual({ status: "denied" });
		if ("version" in state) {
			const child = state.version.nodes.get("child");
			if (!child) throw new Error("missing child");
			child.denied = false;
			child.readOnly = true;
		} else {
			const child = state.roots[1]?.children[0];
			if (!child) throw new Error("missing child");
			child.denied = false;
			child.readOnly = true;
		}
		expect(afterWrite("readonly")).toEqual({ status: "denied" });
		if ("version" in state) {
			const child = state.version.nodes.get("child");
			if (!child) throw new Error("missing child");
			child.readOnly = false;
			child.revision = {};
		} else {
			const child = state.roots[1]?.children[0];
			if (!child) throw new Error("missing child");
			child.readOnly = false;
			child.revision = {};
		}
		expect(afterWrite("conflict")).toEqual({ status: "conflict" });
		if ("version" in state) {
			if (!("change" in host)) throw new Error("invalid host");
			host.change(instance, (draft) => {
				const child = draft.nodes.get("child");
				if (child) child.token = {};
			});
		} else {
			if (!("bump" in host)) throw new Error("invalid host");
			const child = state.roots[1]?.children[0];
			if (!child) throw new Error("missing child");
			child.token = {};
			host.bump(state);
		}
		expect(afterWrite("replaced-stale")).not.toEqual({ status: "applied" });
		expect(bind()("replacement-live")).toEqual({ status: "applied" });
		if ("version" in state) {
			if (!("change" in host)) throw new Error("invalid host");
			host.change(instance, (draft) => {
				const parent = draft.nodes.get("first");
				if (parent) parent.children = [];
				const child = draft.nodes.get("child");
				if (child) child.token = {};
			});
		} else {
			if (!("bump" in host)) throw new Error("invalid host");
			const parent = state.roots[1];
			if (parent) parent.children = [];
			host.bump(state);
		}
		expect(afterWrite("removed")).not.toEqual({ status: "applied" });
		expect(host.submissions).toHaveLength(0);
		runtime.dispose();
	});

	it(`${name}: projected writer must belong to the exact read row and ancestor`, async () => {
		const host = factory();
		const runtime = createPrivateKaladaRuntime({
			definition,
			policy,
			identity,
			strategy: host.strategy,
			directLocations,
		});
		const instance = [...host.states.keys()][0] as object;
		const state = host.states.get(instance);
		if (!state) throw new Error("missing state");
		if ("version" in state) {
			if (!("change" in host)) throw new Error("invalid host");
			host.change(instance, (draft) => {
				const first = draft.nodes.get("first");
				if (!first) throw new Error("missing parent");
				first.children.push("sibling");
				draft.nodes.set("sibling", {
					...first,
					...{ id: "sibling", token: {}, revision: {}, quantity: "sibling-quantity", children: [] },
				});
				const second = draft.nodes.get("second");
				if (!second) throw new Error("missing parent");
				second.children.push("alias");
				draft.nodes.set("alias", {
					...first,
					id: "alias",
					token: {},
					revision: {},
					quantity: "alias-quantity",
					children: [],
				});
			});
		} else {
			if (!("bump" in host)) throw new Error("invalid host");
			const first = state.roots[0];
			const second = state.roots[1];
			const child = first?.children[0];
			if (!first || !second || !child) throw new Error("missing parents");
			first.children.push({ ...child, id: "sibling", token: {}, revision: {}, quantity: "sibling-quantity" });
			second.children.push({ ...child, id: "alias", token: {}, revision: {}, quantity: "alias-quantity" });
			host.bump(state);
		}
		const outer = runtime.capture().enumerateRows("root");
		if (!outer.ok || !outer.rows[0] || !outer.rows[1]) throw new Error("missing outer rows");
		const first = runtime.capture().enumerateRows("root.children[0]", outer.rows[0].scope);
		const second = runtime.capture().enumerateRows("root.children[0]", outer.rows[1].scope);
		if (!first.ok || !second.ok || !first.rows[0] || !first.rows[1] || !second.rows[0])
			throw new Error("missing children");
		const snapshot = runtime.captureSubmission();
		if (snapshot.status !== "found") throw new Error("missing submission");
		const initial = JSON.stringify(snapshot.request.data);
		const notify = host.notifications.mock.calls.length;
		for (const [scope, writer] of [
			[first.rows[0].scope, first.rows[1]],
			[second.rows[0].scope, first.rows[0]],
		] as const) {
			expect(() => runtime.projectCustom(customPath, scope, writer, { edit: "line.quantity" })).toThrow(/STALE_SCOPE/);
			expect(() => runtime.projectNative(nativeWrite, scope, writer, "line.quantity")).toThrow(
				/INVALID_NATIVE_BINDING/,
			);
		}
		expect(host.notifications.mock.calls.length).toBe(notify);
		expect(host.submissions).toHaveLength(0);
		expect(JSON.stringify(snapshot.request.data)).toBe(initial);
		expect((runtime.captureSubmission() as typeof snapshot).request.data).toEqual(snapshot.request.data);
		const edit = runtime.projectCustom(customPath, first.rows[1].scope, first.rows[1], { edit: "line.quantity" })
			.edit as {
			onChange: (value: unknown) => { status: string };
		};
		expect(edit.onChange("matched")).toEqual({ status: "applied" });
		if ("version" in state) {
			if (!("change" in host)) throw new Error("invalid host");
			host.change(instance, (draft) => draft.roots.reverse());
		} else {
			if (!("bump" in host)) throw new Error("invalid host");
			state.roots.reverse();
			host.bump(state);
		}
		const reordered = runtime.capture().enumerateRows("root");
		if (!reordered.ok) throw new Error("missing reordered parents");
		const parent = reordered.rows.find((item) => item.token === outer.rows[0]?.token);
		if (!parent) throw new Error("missing reordered parent");
		const children = runtime.capture().enumerateRows("root.children[0]", parent.scope);
		if (!children.ok || !children.rows[1]) throw new Error("missing reordered child");
		expect(
			runtime
				.projectNative(nativeWrite, children.rows[1].scope, children.rows[1], "line.quantity")
				.onChange("after-reorder"),
		).toEqual({ status: "applied" });
		runtime.dispose();
	});
}
