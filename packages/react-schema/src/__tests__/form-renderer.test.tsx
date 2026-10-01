// @vitest-environment jsdom
import { createKaladaV1Host } from "@formbar/declarative";
import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it } from "vitest";
import { serialHost } from "../../../../scripts/kalada-preflight/fixtures/row-write-hosts.js";
import { snapshotAdmissionPolicy } from "../../../declarative/src/validators/kalada-policy.js";
import { FormRenderer } from "../form-renderer.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const identity = { generation: "g1", fingerprint: "host" };
const ref = { namespace: "data" as const, segments: ["profile", "name"] };
const policy = snapshotAdmissionPolicy({
	...identity,
	widgets: {},
	renderers: {
		"demo.editor": {
			children: "forbidden",
			props: {
				current: { modes: ["read"], expected: "string" },
				edit: { modes: ["write"], expected: "string" },
			},
		},
	},
	actions: {},
	namespaces: { data: "available" },
	schema: { side: "input", availability: "complete", paths: [{ path: ref.segments, kind: "value" }] },
	ui: { availability: "complete", paths: [] },
});
const definition = {
	version: 1,
	id: "public",
	root: {
		type: "group",
		id: "root",
		children: [
			{ type: "field", id: "name", widget: "text", binding: ref },
			{
				type: "custom",
				id: "editor",
				renderer: "demo.editor",
				props: {
					current: {
						mode: "read",
						expression: {
							format: "kalada-program",
							version: 1,
							profile: "kalada-v1",
							expression: { kind: "ref", ref },
						},
					},
					edit: { mode: "write", reference: ref },
				},
			},
			{
				type: "output",
				id: "preview",
				value: { format: "kalada-program", version: 1, profile: "kalada-v1", expression: { kind: "ref", ref } },
			},
		],
	},
};
const location = {
	profile: {
		target: { namespace: "data" as const, segments: ["profile"] },
		type: { kind: "primitive-type" as const, name: "json" as const },
		writable: true as const,
		properties: {
			name: { type: { kind: "primitive-type" as const, name: "string" as const }, writable: true as const },
		},
	},
};
const mounted: Array<() => void> = [];
afterEach(async () => {
	for (const dispose of mounted.splice(0)) await act(async () => dispose());
});

it("fails closed on the old FormApi/Kuery renderer path", () => {
	expect(() => FormRenderer({ form: {}, definition: {} } as never)).toThrow("root: MISSING_STRATEGY");
});

it("renders native, trusted CUSTOM READ/WRITE and reactive Output.value from one host snapshot", async () => {
	const serial = serialHost();
	const host = createKaladaV1Host({
		definition,
		policy,
		identity,
		strategy: serial.strategy,
		writeSources: {
			"root.children[0].binding": "profile.name",
			"root.children[1].props.edit.reference": "profile.name",
		},
		directLocations: { "root.children[0].binding": location, "root.children[1].props.edit.reference": location },
		installed: { renderers: new Set(["demo.editor"]) },
	});
	const container = document.createElement("div");
	const react = createRoot(container);
	mounted.push(() => {
		react.unmount();
		host.dispose();
	});
	const renderers = {
		"demo.editor": ({
			props,
			writers,
		}: {
			props: Readonly<Record<string, unknown>>;
			writers: Readonly<Record<string, (value: unknown) => { status: string }>>;
		}) => (
			<button type="button" onClick={() => writers.edit?.("edited")}>
				{String(props.current)}
			</button>
		),
	};
	await act(async () => react.render(<FormRenderer host={host} renderers={renderers} />));
	expect(container.querySelector("input")?.getAttribute("value")).toBe("original");
	const input = container.querySelector<HTMLInputElement>("input");
	const label = container.querySelector("label");
	expect(label?.htmlFor).toBe(input?.id);
	expect(input?.getAttribute("aria-label") ?? label?.textContent).toBeTruthy();
	expect(container.querySelector("[data-kalada-output] output")?.textContent).toBe("original");
	await act(async () => container.querySelector<HTMLButtonElement>("button[type=button]")?.click());
	expect(container.querySelector("input")?.getAttribute("value")).toBe("edited");
	expect(container.querySelector("[data-kalada-output] output")?.textContent).toBe("edited");
	expect(host.snapshot().data).toMatchObject({ profile: { name: "edited" } });
	await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
	expect(container.querySelector("[data-kalada-status]")?.textContent).toBe("submitted");
	expect(serial.submissions).toEqual([host.snapshot().data]);
});

it("hydrates stable host-derived field and output IDs without replacing DOM nodes", async () => {
	const serial = serialHost();
	const host = createKaladaV1Host({
		definition,
		policy,
		identity,
		strategy: serial.strategy,
		writeSources: {
			"root.children[0].binding": "profile.name",
			"root.children[1].props.edit.reference": "profile.name",
		},
		directLocations: { "root.children[0].binding": location, "root.children[1].props.edit.reference": location },
		installed: { renderers: new Set(["demo.editor"]) },
	});
	const renderers = { "demo.editor": () => <span>Editor</span> };
	const element = <FormRenderer host={host} renderers={renderers} />;
	const container = document.createElement("div");
	container.innerHTML = renderToString(element);
	document.body.append(container);
	const original = container.querySelector("input");
	const label = container.querySelector("label");
	const output = container.querySelector("[data-kalada-output] output");
	let root!: ReturnType<typeof hydrateRoot>;
	await act(async () => {
		root = hydrateRoot(container, element);
	});
	expect(container.querySelector("input")).toBe(original);
	expect(label?.htmlFor).toBe(original?.id);
	expect(container.querySelector("[data-kalada-output] output")).toBe(output);
	mounted.push(() => {
		root.unmount();
		host.dispose();
		container.remove();
	});
});

it("uses host row tokens across reorder and revokes callbacks on removed rows", async () => {
	const serial = serialHost();
	const rowRef = { namespace: "data" as const, scope: "inner", segments: ["value"] };
	const rowPolicy = snapshotAdmissionPolicy({
		...identity,
		widgets: {},
		renderers: {},
		actions: {},
		namespaces: { data: "available" },
		schema: {
			side: "input",
			availability: "complete",
			paths: [
				{ path: ["rows"], kind: "array" },
				{ path: ["rows", { row: "outer" }, "nested"], kind: "array" },
				{ path: ["rows", { row: "outer" }, "nested", { row: "inner" }, "value"], kind: "value" },
			],
		},
		ui: { availability: "complete", paths: [] },
	});
	const host = createKaladaV1Host({
		identity,
		policy: rowPolicy,
		strategy: serial.strategy,
		definition: {
			version: 1,
			id: "rows",
			root: {
				type: "repeater",
				id: "rows",
				scope: "outer",
				binding: { namespace: "data", segments: ["rows"] },
				children: [
					{
						type: "repeater",
						id: "nested",
						scope: "inner",
						binding: { namespace: "data", scope: "outer", segments: ["nested"] },
						children: [{ type: "field", id: "value", widget: "text", binding: rowRef }],
					},
				],
			},
		},
		writeSources: { "root.children[0].children[0].binding": "line.value" },
		directLocations: {
			"root.children[0].children[0].binding": {
				line: {
					target: { namespace: "data", scope: "inner", segments: [] },
					type: { kind: "primitive-type", name: "json" },
					writable: true,
					properties: { value: { type: { kind: "primitive-type", name: "string" }, writable: true } },
				},
			},
		},
	});
	const container = document.createElement("div");
	const react = createRoot(container);
	mounted.push(() => {
		react.unmount();
		host.dispose();
	});
	await act(async () => react.render(<FormRenderer host={host} />));
	const before = host.snapshot().controls;
	const original = before.find((control) => control.value === "child");
	expect(original).toBeDefined();
	const state = [...serial.states.values()][0];
	if (!state) throw new Error("missing installed host state");
	state.roots.reverse();
	await act(async () => serial.bump(state));
	const moved = host.snapshot().controls.find((control) => control.value === "child");
	expect(moved?.key).toBe(original?.key);
	expect(container.querySelectorAll("input")).toHaveLength(1);
	expect(original?.writers.value?.("stale")).toEqual({ status: "stale" });
	state.roots.splice(1, 1);
	await act(async () => serial.bump(state));
	expect(host.snapshot().controls).toHaveLength(0);
	expect(moved?.writers.value?.("removed")).not.toEqual({ status: "applied" });
	expect(await host.submit()).toMatchObject({ status: "submitted" });
	expect(serial.submissions).toEqual([host.snapshot().data]);
});
