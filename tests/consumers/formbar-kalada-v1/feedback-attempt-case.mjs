import assert from "node:assert/strict";
import { FormRenderer } from "@formbar/react-schema";
import * as React from "react";
import { createRoot } from "react-dom/client";
const act = React.act ?? (await import("react-dom/test-utils")).act;

async function submit(fixture) {
	let result;
	await act(async () => {
		result = await fixture.host.submit();
	});
	return result;
}
function untouched(fixture, count, submitted = false) {
	const view = fixture.host.snapshot();
	const field = view.controls.find((control) => control.nodeId === "name");
	assert.equal(view.lifecycle.submitCount, count);
	assert.equal(view.lifecycle.submitted, submitted);
	assert.equal(field.lifecycle.submitCount, count);
	assert.equal(field.lifecycle.dirty, false);
	assert.equal(field.lifecycle.touched, false);
}

export async function runFirstSubmit(factory, options) {
	const fixture = factory({ ...options, untouched: true });
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () => root.render(React.createElement(FormRenderer, { host: fixture.host })));
		untouched(fixture, 0);
		assert.equal(container.querySelector("[data-kalada-validation]"), null);
		assert.equal((await submit(fixture)).status, "denied");
		untouched(fixture, 1);
		const feedback = container.querySelector('[data-kalada-validation="name-feedback"]');
		assert.ok(feedback);
		assert.ok(feedback.querySelector("ul"));
		assert.equal(
			feedback.textContent,
			options.messages === undefined ? "Must contain at least 3 character(s)." : options.messages.join(""),
		);
		const input = container.querySelector('[data-kalada-control="name"] input');
		const ids = input.getAttribute("aria-describedby").split(" ");
		assert.equal(ids.includes(feedback.id), options.messages === undefined || options.messages.length > 0);
		for (const id of ids) assert.ok(container.contains(document.getElementById(id)));
		assert.equal(input.getAttribute("aria-invalid"), "true");
		assert.equal((await submit(fixture)).status, "denied");
		untouched(fixture, 2);
		await act(async () => assert.equal(fixture.host.reset().ok, true));
		untouched(fixture, 0);
		assert.equal(fixture.host.snapshot().data.name, "");
		assert.equal(container.querySelector("[data-kalada-validation]"), null);
		await act(async () => fixture.host.validate());
		untouched(fixture, 0);
		assert.equal(container.querySelector("[data-kalada-validation]"), null, "validation alone is not a submit attempt");
		await act(async () => assert.equal(fixture.control("name").writers.value("Ada").status, "applied"));
		assert.equal((await submit(fixture)).status, "submitted");
		assert.equal(fixture.host.snapshot().lifecycle.submitCount, 1);
		assert.equal(fixture.host.snapshot().lifecycle.submitted, true);
		fixture.forceFailure(true);
		assert.equal((await submit(fixture)).status, "denied");
		assert.equal(fixture.host.snapshot().lifecycle.submitCount, 2);
		assert.equal(
			fixture.host.snapshot().lifecycle.submitted,
			true,
			"failed attempt does not erase prior successful history",
		);
	} finally {
		await act(async () => root.unmount());
		fixture.dispose();
		container.remove();
	}
}

export async function runAttemptFences(factory) {
	const stale = factory({ untouched: true, deferred: true });
	try {
		const pending = stale.host.submit();
		await stale.ready;
		assert.equal(stale.host.snapshot().lifecycle.submitCount, 0);
		assert.equal(stale.control("name").writers.value("Ada").status, "applied");
		stale.release();
		assert.notEqual((await pending).status, "submitted");
		assert.equal(stale.host.snapshot().lifecycle.submitCount, 0);
		assert.deepEqual(stale.control("name").lifecycle.issues, { schema: [], extension: [] });
	} finally {
		stale.dispose();
	}
	const revoked = factory({ untouched: true, deferred: true });
	try {
		const pending = revoked.host.submit();
		await revoked.ready;
		const frame = revoked.capture();
		revoked.dispose();
		revoked.release();
		assert.notEqual((await pending).status, "submitted");
		assert.equal(frame.field({ path: "root.children[0]", scope: { rows: [] } }).status, "stale");
		assert.throws(() => revoked.host.snapshot());
	} finally {
		revoked.dispose();
	}
	const missing = factory({ untouched: true });
	try {
		missing.refusal("missing-host");
		assert.equal((await missing.host.submit()).status, "denied");
		assert.equal(missing.capture().form.submitCount, 0);
		assert.deepEqual(missing.capture().form.issues, { schema: [], extension: [] });
	} finally {
		missing.dispose();
	}
	for (const options of [{ fieldVisible: false }, { feedbackVisible: false }]) {
		const hidden = factory({ ...options, untouched: true, messages: ["Correct the name"] });
		const container = document.createElement("div");
		const root = createRoot(container);
		document.body.append(container);
		try {
			await act(async () => root.render(React.createElement(FormRenderer, { host: hidden.host })));
			assert.equal((await submit(hidden)).status, "denied");
			assert.equal(hidden.host.snapshot().lifecycle.submitCount, 1);
			assert.equal(container.querySelector("[data-kalada-validation]"), null);
		} finally {
			await act(async () => root.unmount());
			hidden.dispose();
			container.remove();
		}
	}
}
