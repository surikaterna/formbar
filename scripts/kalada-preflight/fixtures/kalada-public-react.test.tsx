// @vitest-environment jsdom
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
import { createKaladaV1Host } from "@formbar/declarative";
import { KaladaFormRenderer } from "@formbar/react-schema";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { snapshotAdmissionPolicy } from "../../../packages/declarative/src/validators/kalada-policy.js";
import { serialHost } from "./row-write-hosts.js";

const identity = { generation: "g1", fingerprint: "host" };
const ref = { namespace: "data" as const, segments: ["profile", "name"] };
const program = (expression: unknown) => ({ format: "kalada-program", version: 1, profile: "kalada-v1", expression });
const policy = snapshotAdmissionPolicy({
	...identity,
	widgets: {},
	actions: {},
	namespaces: { data: "available" },
	renderers: {
		"demo.editor": {
			children: "forbidden",
			props: {
				current: { modes: ["read"], expected: "string" },
				edit: { modes: ["write"], expected: "string" },
			},
		},
	},
	schema: { side: "input", availability: "complete", paths: [{ path: ref.segments, kind: "value" }] },
	ui: { availability: "complete", paths: [] },
});
const definition = {
	version: 1,
	id: "authored",
	root: {
		type: "group",
		id: "root",
		children: [
			{ type: "field", id: "native", widget: "text", binding: ref },
			{
				type: "custom",
				id: "custom",
				renderer: "demo.editor",
				props: {
					current: { mode: "read", expression: program({ kind: "ref", ref }) },
					edit: { mode: "write", reference: ref },
				},
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

it("candidate authored React native and trusted custom use only strategy values, writers and outgoing submission", async () => {
	const strategy = serialHost();
	const host = createKaladaV1Host({
		definition,
		policy,
		identity,
		strategy: strategy.strategy,
		writeSources: {
			"root.children[0].binding": "profile.name",
			"root.children[1].props.edit.reference": "profile.name",
		},
		directLocations: { "root.children[0].binding": location, "root.children[1].props.edit.reference": location },
		installed: { renderers: new Set(["demo.editor"]) },
	});
	const root = document.createElement("div");
	const react = createRoot(root);
	const renderer = {
		"demo.editor": ({
			props,
			writers,
		}: {
			props: Readonly<Record<string, unknown>>;
			writers: Readonly<Record<string, (value: unknown) => { status: string }>>;
		}) => (
			<div>
				<output data-read="">{String(props.current)}</output>
				<button type="button" onClick={() => writers.edit?.("custom-value")}>
					edit
				</button>
			</div>
		),
	};
	await act(async () => react.render(<KaladaFormRenderer host={host} renderers={renderer} />));
	expect(root.querySelector<HTMLInputElement>("input")?.value).toBe("original");
	expect(root.querySelector("[data-read]")?.textContent).toBe("original");
	const input = root.querySelector<HTMLInputElement>("input");
	if (!input) throw new Error("missing native input");
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "native-value");
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
	expect(host.snapshot().controls.find((control) => control.nodeId === "native")?.value).toBe("native-value");
	await act(async () => root.querySelector<HTMLButtonElement>("button[type=button]")?.click());
	expect(root.querySelector<HTMLInputElement>("input")?.value).toBe("custom-value");
	expect(root.querySelector("[data-read]")?.textContent).toBe("custom-value");
	expect(host.snapshot().data).toEqual(expect.objectContaining({ profile: { name: "custom-value" } }));
	await act(async () =>
		root.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
	);
	expect(root.querySelector("[data-kalada-status]")?.textContent).toBe("submitted");
	await act(async () => react.unmount());
	host.dispose();
});

it("refuses a custom renderer absent from the installed host registry", () => {
	const strategy = serialHost();
	expect(() =>
		createKaladaV1Host({
			definition,
			policy,
			identity,
			strategy: strategy.strategy,
			writeSources: {
				"root.children[0].binding": "profile.name",
				"root.children[1].props.edit.reference": "profile.name",
			},
			directLocations: { "root.children[0].binding": location, "root.children[1].props.edit.reference": location },
		}),
	).toThrow(/root.children\[1\].renderer: MISSING_RENDERER/);
});

it("renders a host-installed action button with pending and typed result without FormApi", async () => {
	const strategy = serialHost();
	const host = createKaladaV1Host({
		definition: { version: 1, id: "actions", root: { type: "action", id: "save", label: "Save", action: "submit" } },
		policy,
		identity,
		strategy: strategy.strategy,
	});
	const root = document.createElement("div");
	const react = createRoot(root);
	await act(async () => react.render(<KaladaFormRenderer host={host} />));
	const button = root.querySelector<HTMLButtonElement>("[data-kalada-action=save] button");
	expect(button?.textContent).toBe("Save");
	await act(async () => button?.click());
	expect(root.querySelector("[data-kalada-action=save] output")?.textContent).toContain("root: submitted");
	await act(async () => react.unmount());
	host.dispose();
});
