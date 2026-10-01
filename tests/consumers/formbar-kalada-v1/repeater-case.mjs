import assert from "node:assert/strict";
import { FormRenderer } from "@formbar/react-schema";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { instrumentView, repeaterFixture } from "./repeater-fixture.mjs";

const act = React.act ?? (await import("react-dom/test-utils")).act;

export function runScaling(rows, outputs = false) {
	const fixture = repeaterFixture({ rows, outputs });
	const measured = instrumentView(fixture.host);
	const original = console.error;
	console.error = () => {};
	try {
		measured.start();
		const html = renderToString(React.createElement(FormRenderer, { host: measured.host }));
		measured.assert(rows * 5, outputs);
		assert.equal((html.match(/<input /g) ?? []).length, rows * 5);
		assert.equal((html.match(/data-kalada-output=/g) ?? []).length, outputs ? rows * 5 : 0);
		assert.equal(fixture.metrics.submissions, 1);
		assert.equal(fixture.metrics.enumerations, 1);
		assert.equal(
			fixture.metrics.captures,
			rows * 5 + 1,
			"one view capture plus one existing checked row-writer proof capture per field",
		);
		console.log(
			`SSR_LINEAR_COUNTS rows=${rows} fields=${rows * 5} outputs=${outputs ? rows * 5 : 0} ${JSON.stringify({ ...measured.counts, ...fixture.metrics })}`,
		);
	} finally {
		measured.stop();
		console.error = original;
		fixture.dispose();
	}
}

function button(scope, id) {
	const result = scope.querySelector(`[data-kalada-action="${id}"] button`);
	assert.ok(result, `Missing ${id}`);
	return result;
}
function destination(scope, id, key) {
	const select = scope.querySelector(`[data-kalada-action="${id}"] select`);
	assert.ok(select);
	select.value = key;
	select.dispatchEvent(new window.Event("change", { bubbles: true }));
}
async function click(element) {
	await act(async () => {
		element.focus();
		element.click();
	});
}

export async function runFocus(options = {}) {
	const fixture = repeaterFixture(options);
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const collection = () =>
		[...container.querySelectorAll('fieldset[data-formbar-node="rows"]')][options.nested ? 0 : 0];
	const group = () => collection().parentElement;
	try {
		await act(async () => root.render(React.createElement(FormRenderer, { host: fixture.host })));
		const before = [...collection().querySelectorAll("input")];
		if (!options.values) {
			const moving = button(collection(), "rows-move");
			const keys = fixture.host.snapshot().rows.filter((row) => row.path.endsWith("children[0]"));
			const dest = keys.find((row) => row.order === 1)?.key;
			assert.ok(dest);
			await act(async () => destination(collection(), "rows-move", dest));
			await click(moving);
			assert.ok(document.activeElement === moving, "move preserves clicked logical row button focus");
			assert.deepEqual(
				[...collection().querySelectorAll("input")].map((input, i) => input === [before[1], before[0]][i]),
				[true, true],
			);
			const swapping = button(collection(), "rows-swap");
			const currentKeys = fixture.host.snapshot().rows.filter((row) => row.path.endsWith("children[0]"));
			await act(async () => destination(collection(), "rows-swap", currentKeys.find((row) => row.order === 1).key));
			await click(swapping);
			assert.ok(document.activeElement === swapping, "swap preserves clicked logical row button focus");
			assert.deepEqual(
				[...collection().querySelectorAll("input")].map((input, i) => input === before[i]),
				[true, true],
			);
		}
		if (!options.values && options.append !== false && !options.disabled) {
			await click(button(group(), "rows-append"));
			const added = [...collection().querySelectorAll("input")].at(-1);
			assert.ok(document.activeElement === added, "append focuses inserted logical row control");
			assert.equal(added.value, "added");
			const keys = fixture.host.snapshot().rows.filter((row) => row.path.endsWith("children[0]"));
			await act(async () => destination(group(), "rows-insert", keys.find((row) => row.order === 0).key));
			await click(button(group(), "rows-insert"));
			assert.ok(
				document.activeElement === collection().querySelector("input"),
				"insert focuses inserted logical row control",
			);
			assert.equal(document.activeElement.value, "inserted");
		}
		const inputs = [...collection().querySelectorAll("input")];
		const removing = button(collection(), "rows-remove");
		const draft = fixture.data();
		fixture.deny(true);
		await click(removing);
		assert.ok(document.activeElement === removing, "denied mutation preserves focus");
		assert.deepEqual(fixture.data(), draft);
		fixture.deny(false);
		await click(removing);
		if (inputs.length > 1) assert.ok(document.activeElement === inputs[1], "remove focuses surviving next row");
		else if (options.append !== false && !options.disabled)
			assert.ok(document.activeElement === button(group(), "rows-append"), "final remove focuses exact append");
		else assert.ok(document.activeElement === collection(), "final remove falls back to concrete repeater container");
		if (options.duplicate)
			assert.ok(group().contains(document.activeElement), "same-binding sibling cannot steal focus");
		if (options.nested) {
			const other = [...container.querySelectorAll('fieldset[data-formbar-node="rows"]')][1];
			assert.ok(!other.contains(document.activeElement), "different parent token cannot steal nested focus");
		}
	} finally {
		await act(async () => root.unmount());
		fixture.dispose();
		container.remove();
	}
}

export async function runDuplicateFocus() {
	const fixture = repeaterFixture({ duplicate: true, values: ["only"] });
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () => root.render(React.createElement(FormRenderer, { host: fixture.host })));
		const scope = container.querySelector('fieldset[data-formbar-node="duplicate"]');
		await click(button(scope, "duplicate-remove"));
		assert.ok(
			document.activeElement === button(scope.parentElement, "duplicate-append"),
			"duplicate scope owns exact append fallback",
		);
		assert.equal(container.querySelectorAll("input").length, 0);
		await click(button(scope.parentElement, "duplicate-append"));
		assert.ok(document.activeElement === scope.querySelector("input"), "duplicate append focuses its own logical row");
		assert.ok(document.activeElement !== container.querySelector('fieldset[data-formbar-node="rows"] input'));
	} finally {
		await act(async () => root.unmount());
		fixture.dispose();
		container.remove();
	}
}

export async function runLateFocus(mode) {
	const fixture = repeaterFixture({ values: ["only"] });
	const held = [];
	function delayed(node) {
		const action = node.action;
		return {
			...node,
			...(node.nodeId === "rows-remove" && action
				? {
						action: {
							...action,
							invoke(key) {
								return new Promise((resolve) =>
									action.invoke(key).then((outcome) => held.push(() => resolve(outcome))),
								);
							},
						},
					}
				: {}),
			...(node.children ? { children: node.children.map(delayed) } : {}),
			...(node.rows ? { rows: node.rows.map((row) => ({ ...row, children: row.children.map(delayed) })) } : {}),
		};
	}
	const host = {
		...fixture.host,
		snapshot() {
			const view = fixture.host.snapshot();
			return { ...view, tree: delayed(view.tree) };
		},
	};
	const container = document.createElement("div");
	const outside = document.createElement("button");
	document.body.append(container, outside);
	const root = createRoot(container);
	try {
		await act(async () => root.render(React.createElement(FormRenderer, { host })));
		await click(button(container, "rows-remove"));
		assert.equal(held.length, 1);
		if (mode === "unmount") await act(async () => root.unmount());
		if (mode === "dispose") fixture.dispose();
		if (mode === "stale") {
			const append = fixture.host.snapshot().tree.children[0].children.find((node) => node.nodeId === "rows-append");
			await act(async () => {
				assert.equal((await append.action.invoke()).status, "applied");
			});
		}
		outside.focus();
		const draft = fixture.data();
		await act(async () => held[0]());
		assert.ok(document.activeElement === outside, `${mode} late action cannot steal focus`);
		assert.deepEqual(fixture.data(), draft);
	} finally {
		await act(async () => root.unmount());
		fixture.dispose();
		container.remove();
		outside.remove();
	}
}

export function runMissingViewKeys() {
	for (const kind of ["controls", "outputs"]) {
		const fixture = repeaterFixture({ rows: 1, outputs: true });
		const host = {
			...fixture.host,
			snapshot() {
				const view = fixture.host.snapshot();
				return { ...view, [kind]: view[kind].slice(1) };
			},
		};
		try {
			assert.throws(
				() => renderToString(React.createElement(FormRenderer, { host })),
				new RegExp(`MISSING_${kind === "controls" ? "CONTROL" : "OUTPUT"}`),
			);
		} finally {
			fixture.dispose();
		}
	}
}

export async function runNestedDuplicateFocus() {
	const fixture = repeaterFixture({ nested: true, duplicate: true });
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () => root.render(React.createElement(FormRenderer, { host: fixture.host })));
		const scope = [...container.querySelectorAll('fieldset[data-formbar-node="duplicate"]')][1];
		const parent = scope.parentElement;
		const append = button(parent, "duplicate-append");
		const destinationKey = fixture.host.snapshot().rows.find((row) => row.path === "root" && row.order === 0).key;
		await act(async () => destination(parent, "groups-move", destinationKey));
		await click(button(parent, "groups-move"));
		assert.equal(fixture.data().groups[0].values[0], "other");
		await click(button(scope, "duplicate-remove"));
		assert.ok(document.activeElement === append, "nested reordered parent token owns duplicate append fallback");
		assert.deepEqual(fixture.data().groups[1].values, ["a", "b"]);
		await click(append);
		assert.ok(
			document.activeElement === scope.querySelector("input"),
			"nested duplicate inserted focus stays in clicked concrete scope",
		);
		assert.ok(document.activeElement !== parent.querySelector('fieldset[data-formbar-node="rows"] input'));
	} finally {
		await act(async () => root.unmount());
		fixture.dispose();
		container.remove();
	}
}
