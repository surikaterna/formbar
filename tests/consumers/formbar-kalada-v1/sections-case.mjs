import assert from "node:assert/strict";
import { FormRenderer } from "@formbar/react-schema";
import * as React from "react";
import { createRoot } from "react-dom/client";
const act = React.act ?? (await import("react-dom/test-utils")).act;
const branches = {
	auto: ["make", "model", "year"],
	home: ["address", "sqft", "yearBuilt"],
	life: ["age", "smoker", "conditions"],
};

async function mounted(fixture, run) {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const render = async (next) =>
		act(async () =>
			root.render(React.createElement(FormRenderer, { host: typeof next === "function" ? next() : next })),
		);
	const field = (name) =>
		container.querySelector(
			`[data-kalada-control="${fixture.ids[name]}"] input,[data-kalada-control="${fixture.ids[name]}"] select`,
		);
	try {
		await render(fixture.host);
		await run({ container, field, render, unmount: async () => act(async () => root.unmount()) });
	} finally {
		await act(async () => root.unmount());
		fixture.dispose();
		container.remove();
	}
}
async function write(fixture, name, value) {
	await act(async () => assert.equal(fixture.write(name, value).status, "applied"));
}
async function submit(fixture) {
	let result;
	await act(async () => {
		result = await fixture.host.submit();
	});
	return result;
}

function assertBranch(fixture, field, coverage) {
	for (const [name, names] of Object.entries(branches))
		for (const fieldName of names) {
			const input = field(fieldName);
			if (name !== coverage) {
				assert.equal(input, null);
				continue;
			}
			assert.ok(input, `${coverage} ${fieldName} remains visible`);
			assert.equal(input.required, true);
			assert.equal(input.getAttribute("aria-required"), "true");
			const control = fixture.host.snapshot().controls.find((control) => control.nodeId === fixture.ids[fieldName]);
			assert.equal(control.readOnly, false);
			assert.equal(control.disabled, false);
			assert.ok(control.writers.value);
		}
}

async function assertBrowserIndependent(fixture, field) {
	assert.equal(field("smoker").checked, false);
	assert.equal(field("smoker").checkValidity(), false);
	const check = HTMLFormElement.prototype.checkValidity;
	const report = HTMLFormElement.prototype.reportValidity;
	HTMLFormElement.prototype.checkValidity = () => {
		throw new Error("Browser must not authorize submission");
	};
	HTMLFormElement.prototype.reportValidity = HTMLFormElement.prototype.checkValidity;
	try {
		assert.equal(
			(await submit(fixture)).status,
			"submitted",
			"required cues do not replace the original schema contract",
		);
	} finally {
		HTMLFormElement.prototype.checkValidity = check;
		HTMLFormElement.prototype.reportValidity = report;
	}
}

export async function runSections(factory) {
	const fixture = factory();
	await mounted(fixture, async ({ container, field }) => {
		assert.equal(fixture.managed.visible.size, 0);
		assert.equal(fixture.managed.required.size, 9);
		assert.equal(fixture.managed.disabled.size, 0);
		assert.equal(fixture.managed.readOnly.size, 0);
		let stale;
		for (const coverage of ["auto", "home", "life"]) {
			await write(fixture, "coverageType", coverage);
			assertBranch(fixture, field, coverage);
			if (stale) assert.notEqual(stale("stale branch").status, "applied");
			const text = coverage === "auto" ? "make" : coverage === "home" ? "address" : "conditions";
			await write(fixture, text, `${coverage} retained`);
			stale = fixture.host.snapshot().controls.find((control) => control.nodeId === fixture.ids[text]).writers.value;
		}
		assert.notEqual(fixture.write("make", "hidden edit").status, "applied");
		assert.equal(fixture.write("age", "wrong type").status, "denied");
		await write(fixture, "coverageType", null);
		assert.equal(container.querySelectorAll("input").length, 0);
		assert.equal(stale("retired life edit").status, "stale");
		assert.deepEqual(
			[
				fixture.host.snapshot().data.make,
				fixture.host.snapshot().data.address,
				fixture.host.snapshot().data.conditions,
			],
			["auto retained", "home retained", "life retained"],
		);
		assert.notEqual(
			(await submit(fixture)).status,
			"submitted",
			"clear leaves a schema-invalid enum draft, not a submit grant",
		);
		await write(fixture, "coverageType", "life");
		assert.equal(field("conditions").value, "life retained");
		await assertBrowserIndependent(fixture, field);
	});
}

export async function runRequiredAuthority(factory) {
	const fixture = factory({ enforced: true, omit: true });
	await mounted(fixture, async ({ container, field }) => {
		await write(fixture, "coverageType", "auto");
		assert.notEqual((await submit(fixture)).status, "submitted");
		assert.equal(fixture.submitted.length, 0);
		assert.deepEqual(
			fixture.host.snapshot().controls.find((control) => control.nodeId === fixture.ids.make).lifecycle.issues
				.extension,
			["Selected make is required."],
		);
		assert.equal(field("make").getAttribute("aria-invalid"), "true");
		assert.match(container.textContent, /Selected make is required\./);
		await write(fixture, "make", "Auto make");
		await write(fixture, "model", "Auto model");
		assert.equal((await submit(fixture)).status, "submitted");
		assert.equal(Object.hasOwn(fixture.submitted.at(-1), "address"), false);
		assert.equal(Object.hasOwn(fixture.host.snapshot().data, "address"), true);
		await write(fixture, "coverageType", "home");
		assert.notEqual((await submit(fixture)).status, "submitted");
		assert.deepEqual(
			fixture.host.snapshot().controls.find((control) => control.nodeId === fixture.ids.address).lifecycle.issues
				.extension,
			["Selected address is required."],
		);
		await write(fixture, "address", "Home address");
		fixture.calls.length = 0;
		assert.equal((await submit(fixture)).status, "submitted");
		assert.ok(fixture.calls.length >= 2, "draft and FINAL are independently validated");
		assert.ok(fixture.calls.some((data) => data.make === "Auto make"));
		assert.ok(fixture.calls.some((data) => !Object.hasOwn(data, "make")));
		assert.equal(fixture.host.snapshot().data.make, "Auto make");
		assert.equal(Object.hasOwn(fixture.submitted.at(-1), "make"), false);
		await write(fixture, "coverageType", "life");
		await write(fixture, "conditions", "None");
		assert.equal(
			(await submit(fixture)).status,
			"submitted",
			"false Boolean and zero numeric values are present, not missing required data",
		);
		assert.equal(fixture.submitted.at(-1).smoker, false);
	});
	const schema = factory({ schemaFailure: true });
	await mounted(schema, async () => {
		await write(schema, "coverageType", "home");
		assert.notEqual((await submit(schema)).status, "submitted");
		assert.deepEqual(schema.host.snapshot().lifecycle.issues.schema, ["Must contain at least 3 character(s)."]);
		assert.equal(schema.host.snapshot().data.make, "");
	});
}

export async function runPropertyPolicies(factory) {
	const fixture = factory({ locked: true });
	await mounted(fixture, async ({ field }) => {
		await write(fixture, "coverageType", "auto");
		assert.equal(fixture.managed.visible.size, 0);
		assert.equal(field("make").readOnly, true);
		assert.equal(field("make").required, true);
		assert.equal(field("model").disabled, true);
		assert.equal(field("model").required, true);
		assert.equal(field("year").readOnly, true);
		assert.equal(field("year").required, true);
		for (const name of ["make", "model", "year"]) {
			assert.ok(field(name));
			assert.equal(fixture.write(name, "ungranted").status, "denied");
		}
	});
	const missing = factory({ missing: true });
	try {
		assert.equal(missing.write("coverageType", "auto").status, "applied");
		assert.throws(() => missing.host.snapshot(), {
			message: "root.children[1].then[0].then[0].children[0].required: KALADA_OPERATOR_TYPE",
		});
	} finally {
		missing.dispose();
	}
}

export async function runProfileReinstall(factory) {
	const fixture = factory();
	let replacement;
	await mounted(fixture, async ({ field, render, unmount }) => {
		await write(fixture, "coverageType", "auto");
		await write(fixture, "make", "retained");
		const old = fixture.host.snapshot().controls.find((control) => control.nodeId === fixture.ids.make).writers.value;
		await render(() => {
			replacement = fixture.replace(["formbar.standard.v1"]);
			return replacement.host;
		});
		try {
			await render(replacement.host);
			assert.equal(field("make").required, false);
			assert.equal(field("make").value, "retained");
			assert.notEqual(old("retired profile").status, "applied");
			assert.equal(replacement.host.snapshot().data.make, "retained");
			await write(replacement, "make", "current");
			const current = replacement.host.snapshot().controls.find((control) => control.nodeId === fixture.ids.make)
				.writers.value;
			let restored;
			await render(() => {
				restored = replacement.replace(["formbar.standard.v1", "formbar.arbiter.v1"]);
				return restored.host;
			});
			try {
				await render(restored.host);
				assert.equal(field("make").required, true);
				assert.notEqual(current("retired again").status, "applied");
				assert.equal(restored.host.snapshot().data.make, "current");
			} finally {
				await unmount();
				restored.dispose();
			}
		} finally {
			await unmount();
			replacement.dispose();
		}
	});
}
