import assert from "node:assert/strict";
import { FormRenderer } from "@formbar/react-schema";
import * as React from "react";
import { createRoot } from "react-dom/client";
const act = React.act ?? (await import("react-dom/test-utils")).act;

async function mounted(fixture, run) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () => root.render(React.createElement(FormRenderer, { host: fixture.host })));
		await run(container);
	} finally {
		await act(async () => root.unmount());
		fixture.dispose();
		container.remove();
	}
}
async function invalidate(fixture, control) {
	await act(async () => {
		assert.equal(control.writers.value("Al").status, "applied");
		await fixture.host.validate();
	});
}
function feedbackNode(tree, id) {
	if (tree.nodeId === id) return tree;
	for (const child of [...(tree.children ?? []), ...(tree.rows ?? []).flatMap((row) => row.children)]) {
		const found = feedbackNode(child, id);
		if (found) return found;
	}
}

export async function runFeedback(factory, options) {
	const fixture = factory(options);
	await mounted(fixture, async (container) => {
		assert.equal(
			container.querySelector("[data-kalada-validation]"),
			null,
			"initial valid field has no authored error",
		);
		await invalidate(fixture, fixture.control("name"));
		const element = container.querySelector('[data-kalada-validation="name-feedback"]');
		assert.ok(element, "validation resolves the owned field lifecycle instead of its declaration path");
		assert.equal(element.getAttribute("aria-live"), "polite");
		assert.ok(element.querySelector("ul"));
		const generic = fixture.control("name").lifecycle.issues.schema;
		assert.deepEqual(generic, ["Must contain at least 3 character(s)."]);
		assert.equal(element.textContent, options.messages === undefined ? generic.join("") : options.messages.join(""));
		const input = container.querySelector('[data-kalada-control="name"] input');
		const described = input.getAttribute("aria-describedby").split(" ");
		for (const id of described) assert.ok(container.contains(document.getElementById(id)));
		assert.equal(described.includes(element.id), options.messages === undefined || options.messages.length > 0);
		assert.equal(input.getAttribute("aria-invalid"), "true");
		const view = fixture.host.snapshot();
		const node = feedbackNode(view.tree, "name-feedback");
		const field = view.controls.find((control) => control.nodeId === "name");
		assert.equal(node.lifecycle, field.lifecycle, "same authorized lifecycle object, not equal-path inference");
		assert.equal(node.validationFor, field.key);
		assert.equal(field.lifecycle.dirty, true);
		assert.equal(field.lifecycle.touched, true);
		assert.ok(
			fixture.queries.every((path) => path !== node.path),
			"host never queries a Validation declaration as a field resource",
		);
		await act(async () => assert.equal(fixture.host.reset().ok, true));
		assert.equal(container.querySelector("[data-kalada-validation]"), null);
		assert.equal(fixture.host.snapshot().data.name, "Ada");
	});
}

export async function runFeedbackOwnership(factory) {
	const fixture = factory({ messages: ["Correct the name"], independent: true });
	await mounted(fixture, async (container) => {
		await invalidate(fixture, fixture.control("name"));
		assert.equal(container.querySelector('[data-kalada-validation="name-feedback"]').textContent, "Correct the name");
		assert.deepEqual(fixture.control("name").lifecycle.issues.extension, ["Independent same-path issue"]);
		assert.match(container.querySelector('[data-kalada-control="name"]').textContent, /Independent same-path issue/);
		let outcome;
		await act(async () => {
			outcome = await fixture.host.submit();
		});
		assert.notEqual(outcome.status, "submitted");
		assert.match(fixture.host.snapshot().lifecycle.issues.extension.join(" "), /Independent same-path issue/);
	});
	for (const options of [{ fieldVisible: true }, { feedbackVisible: false }]) {
		const hidden = factory({ ...options, messages: ["Correct the name"] });
		await mounted(hidden, async (container) => {
			await invalidate(hidden, hidden.control("name"));
			if (options.fieldVisible)
				await act(async () => assert.equal(hidden.control("show").writers.value(false).status, "applied"));
			if (options.fieldVisible) await act(async () => hidden.host.validate());
			assert.equal(container.querySelector("[data-kalada-validation]"), null);
			if (options.fieldVisible) assert.equal(hidden.control("name"), undefined);
			assert.equal(hidden.host.snapshot().data.name, "Al");
		});
	}
}

export async function runScopedFeedback(factory) {
	const fixture = factory({ nested: true, messages: ["Correct the name"] });
	await mounted(fixture, async (container) => {
		const rows = fixture.host.snapshot().controls.filter((control) => control.nodeId === "row-name");
		const frame = fixture.capture();
		const view = fixture.host.snapshot();
		const inner = view.tree.children.find((node) => node.nodeId === "groups").rows[0].children[0];
		const rowScopeKey = JSON.parse(inner.rows[0].key);
		assert.ok(rowScopeKey, "concrete logical row key exists");
		await invalidate(fixture, rows[0]);
		assert.equal(container.querySelectorAll('[data-kalada-validation="row-feedback"]').length, 1);
		const invalidInput = container.querySelectorAll('[data-kalada-control="row-name"] input')[0];
		const feedback = container.querySelector('[data-kalada-validation="row-feedback"]');
		assert.ok(invalidInput.getAttribute("aria-describedby").split(" ").includes(feedback.id));
		assert.equal(
			fixture.host.snapshot().controls.filter((control) => control.nodeId === "row-name")[1].lifecycle.valid,
			true,
		);
		assert.equal(frame.field({ path: rows[0].path, scope: { rows: [] } }).status, "stale");
		const current = fixture.capture();
		const scopes = fixture.scopes();
		assert.equal(current.field({ path: rows[0].path, scope: scopes[0] }).value.valid, false);
		assert.equal(
			current.field({ path: rows[0].path, scope: scopes[1] }).value.valid,
			true,
			"another owned row never borrows the invalid row status",
		);
		assert.equal(
			current.field({
				path: rows[0].path,
				scope: {
					rows: [
						{ name: "group", token: {} },
						{ name: "item", token: {} },
					],
				},
			}).status,
			"missing",
		);
		assert.equal(
			current.field({
				path: rows[0].path,
				scope: { rows: scopes[0].rows.map((binding) => ({ ...binding, name: "wrong-scope" })) },
			}).status,
			"missing",
		);
		assert.equal(rows[0].writers.value("old row channel").status, "stale");
	});
}

export function runFeedbackRefusal(factory) {
	assert.throws(() => factory({ duplicate: true, messages: ["Correct the name"] }), {
		message: "root.children[2].binding: AMBIGUOUS_VALIDATION_FIELD",
	});
	for (const mode of ["denied", "stale"]) {
		const fixture = factory();
		try {
			fixture.refusal(mode);
			assert.throws(() => fixture.host.snapshot(), { message: `root.children[0]: LIFECYCLE_${mode.toUpperCase()}` });
		} finally {
			fixture.dispose();
		}
	}
}
