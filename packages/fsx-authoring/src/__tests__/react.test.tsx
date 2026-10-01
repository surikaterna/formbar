// @vitest-environment jsdom
import { type KaladaControlProps, KaladaFormRenderer } from "@formbar/react-schema";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { compilerFixture } from "../../../../tests/consumers/fsx-authoring/fixture.js";
import { compileFsx } from "../index.js";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it.each([
	["line", false, "line"],
	["item", true, " item "],
	["product", true, "(product)"],
] as const)(
	"source → public admission → React native/custom %s writers and stale denial without recompilation",
	async (scope, wholeItem, location) => {
		const { host, ports, result } = compilerFixture(compileFsx, scope, wholeItem, location);
		const element = document.createElement("div");
		const root = createRoot(element);
		const Editor = ({ props, writers }: KaladaControlProps) => (
			<button type="button" onClick={() => writers.edit?.("custom-value")}>
				{String(props.current)}
			</button>
		);
		await act(async () => root.render(<KaladaFormRenderer host={host} renderers={{ "host.editor": Editor }} />));
		expect(host.snapshot().rows).toHaveLength(2);
		const native = element.querySelector<HTMLInputElement>("[data-kalada-control=native] input");
		if (!native) throw new Error("Missing compiled native field");
		await act(async () => {
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(native, "native-value");
			native.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(host.snapshot().outputs.find((output) => output.nodeId === "echo")?.value).toBe("native-value");
		await act(async () => element.querySelector<HTMLButtonElement>("[data-kalada-control=editor] button")?.click());
		expect(native.value).toBe("custom-value");
		expect(host.snapshot().outputs.find((output) => output.nodeId === "message")?.value).toBe("changed");
		const rowInput = element.querySelector<HTMLInputElement>("[data-kalada-control=quantity] input");
		if (!rowInput) throw new Error("Missing compiled repeater native field");
		await act(async () => {
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(rowInput, "native-row");
			rowInput.dispatchEvent(new Event("input", { bubbles: true }));
		});
		expect(host.snapshot().outputs.find((output) => output.nodeId === "row-echo")?.value).toBe("native-row");
		await act(async () => element.querySelector<HTMLButtonElement>("[data-kalada-control=row-editor] button")?.click());
		const first = ports.data().rows[0];
		expect(typeof first === "string" ? first : first?.quantity).toBe("custom-value");
		const old = host.snapshot().controls.find((control) => control.nodeId === "row-editor")?.writers.edit;
		await act(async () => ports.reorder());
		expect(old?.("must-not-retarget").status).toBe("stale");
		const removed = host.snapshot().controls.find((control) => control.nodeId === "row-editor")?.writers.edit;
		await act(async () => ports.remove());
		expect(removed?.("must-not-write-removed").status).toBe("stale");
		await act(async () => {
			expect(await host.submit()).toMatchObject({ status: "submitted" });
		});
		expect(ports.submitted).toEqual([ports.data()]);
		expect(host.definition).toEqual(result.definition);
		await act(async () => root.unmount());
		host.dispose();
	},
);
