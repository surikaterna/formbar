import assert from "node:assert/strict";
import { KaladaFormRenderer } from "@formbar/react-schema";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { compilerFixture } from "./fsx-fixture.mjs";

export async function exercise(compiler, scope = "line", wholeItem = false, location = scope) {
	const { host, ports, result, options } = compilerFixture(compiler, scope, wholeItem, location);
	const invalid = compiler(
		'<Form id="bad" defaultLanguage="Kalada"><Field id="f" value={name + 1} widget="text"/></Form>',
		options,
	);
	assert.equal(invalid.ok, false);
	assert.equal("definition" in invalid, false);
	assert.ok(invalid.diagnostics[0].range);
	const div = document.createElement("div");
	const root = createRoot(div);
	const Editor = ({ props, writers }) =>
		createElement("button", { type: "button", onClick: () => writers.edit("custom-value") }, String(props.current));
	await act(async () => root.render(createElement(KaladaFormRenderer, { host, renderers: { "host.editor": Editor } })));
	assert.equal(host.snapshot().rows.length, 2);
	const input = div.querySelector("[data-kalada-control=native] input");
	assert.ok(input);
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "native-value");
		input.dispatchEvent(new Event("input", { bubbles: true }));
	});
	assert.equal(host.snapshot().outputs.find((output) => output.nodeId === "echo").value, "native-value");
	await act(async () => div.querySelector("[data-kalada-control=editor] button").click());
	assert.equal(input.value, "custom-value");
	assert.equal(host.snapshot().outputs.find((output) => output.nodeId === "message").value, "changed");
	const rowInput = div.querySelector("[data-kalada-control=quantity] input");
	assert.ok(rowInput);
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(rowInput, "native-row");
		rowInput.dispatchEvent(new Event("input", { bubbles: true }));
	});
	assert.equal(host.snapshot().outputs.find((output) => output.nodeId === "row-echo").value, "native-row");
	await act(async () => div.querySelector("[data-kalada-control=row-editor] button").click());
	assert.equal(wholeItem ? ports.data().rows[0] : ports.data().rows[0].quantity, "custom-value");
	const old = host.snapshot().controls.find((control) => control.nodeId === "row-editor").writers.edit;
	await act(async () => ports.reorder());
	assert.equal(old("must-not-retarget").status, "stale");
	const removed = host.snapshot().controls.find((control) => control.nodeId === "row-editor").writers.edit;
	await act(async () => ports.remove());
	assert.equal(removed("must-not-write-removed").status, "stale");
	await act(async () => assert.equal((await host.submit()).status, "submitted"));
	assert.deepEqual(JSON.parse(JSON.stringify(ports.submitted)), [ports.data()]);
	assert.deepEqual(JSON.parse(JSON.stringify(host.definition)), JSON.parse(JSON.stringify(result.definition)));
	await act(async () => root.unmount());
	host.dispose();
	console.log(
		JSON.stringify({
			compiler: "fsx-v1-experimental",
			scope,
			wholeItem,
			payload: ports.submitted[0],
			diagnostics: invalid.diagnostics,
			recompiled: false,
		}),
	);
}
