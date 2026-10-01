import assert from "node:assert/strict";
import { KALADA_V1_ARTIFACT } from "@formbar/declarative";
import {
	compileDefaultKaladaV1Definition,
	createKaladaSchemaForm,
	jsonSchemaProvider,
	projectSchema,
} from "@formbar/from-schema";
import { FormRenderer } from "@formbar/react-schema";
import { JSDOM } from "jsdom";
import * as React from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.window.document,
	HTMLElement: dom.window.HTMLElement,
	HTMLInputElement: dom.window.HTMLInputElement,
	IS_REACT_ACT_ENVIRONMENT: true,
});
const act = React.act ?? (await import("react-dom/test-utils")).act;
const { createRoot } = await import("react-dom/client");
const schema = {
	type: "object",
	additionalProperties: false,
	properties: {
		amount: { type: "number", minimum: 1, maximum: 9 },
		integer: { type: "integer" },
		name: {
			type: "string",
			minLength: 2,
			maxLength: 8,
			pattern: "^[a-z]*$",
			"x-formbar": { placeholder: "Enter name" },
		},
		note: {
			type: "string",
			minLength: 1,
			maxLength: 20,
			"x-formbar": { widget: "textarea", placeholder: "Enter note" },
		},
		date: { type: "string", format: "date" },
		time: { type: "string", "x-formbar": { widget: "time" } },
	},
};

function fixture(authored = false) {
	const provider = jsonSchemaProvider();
	const definition = structuredClone(
		compileDefaultKaladaV1Definition(projectSchema(schema, { provider, side: "input" }).descriptors),
	);
	if (authored)
		definition.root.children[0].props = {
			min: { mode: "literal", value: 0 },
			max: { mode: "literal", value: 20 },
			step: { mode: "literal", value: "any" },
		};
	if (authored) {
		definition.root.children[4].props = {
			min: { mode: "literal", value: "2026-01-01" },
			max: { mode: "literal", value: "2027-12-31" },
			step: { mode: "literal", value: 2 },
		};
		definition.root.children[5].props = {
			min: { mode: "literal", value: "09:00" },
			max: { mode: "literal", value: "17:30" },
			step: { mode: "literal", value: 30 },
		};
	}
	let owner;
	let revision = {};
	let data = { amount: 1.5, integer: 2, name: "abc", note: "long", date: "2026-09-22", time: "12:30" };
	let checks = [];
	let valid = true;
	const listeners = new Set();
	const granted = (ctx) =>
		owner === ctx.instance && ctx.policyGeneration === "native" && ctx.policyFingerprint === "owned";
	const status = () => ({
		dirty: false,
		touched: false,
		submitted: false,
		validating: false,
		valid,
		issues: { schema: [], extension: [] },
	});
	const strategy = {
		contract: "formbar-data-strategy-v1",
		current: () => revision,
		identity(ctx) {
			owner ??= ctx.instance;
			return { artifact: KALADA_V1_ARTIFACT, policyGeneration: "native", policyFingerprint: "owned" };
		},
		subscribe(ctx, notify) {
			if (!granted(ctx)) return () => {};
			listeners.add(notify);
			return () => listeners.delete(notify);
		},
		capture(ctx) {
			const token = revision;
			return {
				token,
				instance: owner,
				read(ref, scope) {
					return granted(ctx) &&
						token === revision &&
						ref.namespace === "data" &&
						ref.path.length === 1 &&
						Object.hasOwn(data, ref.path[0]) &&
						!scope.rows.length
						? { status: "found", value: data[ref.path[0]] }
						: { status: "denied" };
				},
			};
		},
		writeDirect(ctx, request) {
			if (
				!granted(ctx) ||
				request.expectedInstance !== owner ||
				request.expectedRevision !== revision ||
				request.reference.namespace !== "data" ||
				request.scope.rows.length ||
				!Object.hasOwn(data, request.reference.path[0]) ||
				request.reference.path.length !== 1
			)
				return { status: "stale" };
			const key = request.reference.path[0];
			const value = request.value;
			if (
				value !== null &&
				(key === "amount" || key === "integer"
					? typeof value !== "number" || !Number.isFinite(value) || (key === "integer" && !Number.isSafeInteger(value))
					: typeof value !== "string")
			)
				return { status: "denied" };
			data = { ...data, [key]: value };
			revision = {};
			for (const notify of listeners) notify();
			return { status: "applied" };
		},
		captureSubmission(ctx) {
			return granted(ctx) ? { status: "found", instance: owner, revision, data: { ...data } } : { status: "denied" };
		},
		submitCaptured(ctx, request, fresh) {
			if (
				!granted(ctx) ||
				!fresh() ||
				request.revision !== revision ||
				!valid ||
				JSON.stringify(data) !== JSON.stringify(request.data)
			)
				return { status: "denied" };
			return { status: "submitted" };
		},
		installSchemaValidation(ctx, validators) {
			if (!granted(ctx)) return { status: "denied" };
			checks = validators;
			return { status: "installed" };
		},
		captureLifecycle(ctx) {
			return granted(ctx)
				? {
						instance: owner,
						revision,
						initial: data,
						form: status(),
						field: () => ({ status: "found", value: status() }),
					}
				: { status: "denied" };
		},
		async validateLifecycle(ctx, request, fresh) {
			const issues = (
				await Promise.all(checks.map((check) => check({ ...data }, new AbortController().signal)))
			).flat();
			if (!granted(ctx) || !fresh() || request.revision !== revision) return { status: "stale" };
			valid = !issues.length;
			return valid ? { status: "applied", revision } : { status: "invalid" };
		},
		resetLifecycle() {
			return { status: "denied" };
		},
	};
	const fields = definition.root.children;
	const paths = Object.keys(data).map((name) => ({ path: [name], kind: "value" }));
	const writeSources = Object.fromEntries(fields.map((_field, index) => [`root.children[${index}].binding`, "value"]));
	const directLocations = Object.fromEntries(
		fields.map((field, index) => [
			`root.children[${index}].binding`,
			{ value: { target: field.binding, type: { kind: "primitive-type", name: "json" }, writable: true } },
		]),
	);
	return createKaladaSchemaForm(schema, {
		definition: authored ? definition : undefined,
		provider,
		side: "input",
		identity: { generation: "native", fingerprint: "owned" },
		strategy,
		writeSources,
		directLocations,
		policy: {
			generation: "native",
			fingerprint: "owned",
			widgets: {},
			renderers: {},
			actions: {},
			namespaces: { data: "available" },
			schema: { side: "input", availability: "complete", paths },
			ui: { availability: "complete", paths: [] },
		},
	});
}

async function run(authored) {
	const { host } = fixture(authored);
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	try {
		await act(async () => root.render(React.createElement(FormRenderer, { host })));
		const numbers = container.querySelectorAll('input[type="number"]');
		assert.equal(numbers[0].step, "any");
		assert.equal(numbers[1].step, "1");
		assert.equal(numbers[0].validity.valid, true);
		assert.equal(numbers[0].validity.stepMismatch, false);
		assert.deepEqual([numbers[0].min, numbers[0].max], authored ? ["0", "20"] : ["1", "9"]);
		const text = container.querySelector('input[type="text"]');
		assert.deepEqual(
			[text.minLength, text.maxLength, text.pattern, text.placeholder],
			[2, 8, "^[a-z]*$", "Enter name"],
		);
		const note = container.querySelector("textarea");
		assert.deepEqual([note.minLength, note.maxLength, note.placeholder], [1, 20, "Enter note"]);
		assert.equal((await host.submit()).status, "submitted");
		if (authored) {
			const date = container.querySelector('input[type="date"]');
			const time = container.querySelector('input[type="time"]');
			assert.deepEqual([date.min, date.max, date.step], ["2026-01-01", "2027-12-31", "2"]);
			assert.deepEqual([time.min, time.max, time.step], ["09:00", "17:30", "30"]);
		}
		await act(async () => {
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(numbers[0], "");
			numbers[0].dispatchEvent(new dom.window.Event("input", { bubbles: true }));
		});
		assert.equal(host.snapshot().data.amount, null);
		assert.notEqual((await host.submit()).status, "submitted");
		if (authored) {
			await act(async () => host.snapshot().controls[0].writers.value(0.5));
			assert.equal(numbers[0].checkValidity(), true);
			assert.notEqual((await host.submit()).status, "submitted");
		}
	} finally {
		await act(async () => root.unmount());
		host.dispose();
		container.remove();
	}
}
await run(false);
await run(true);
dom.window.close();
console.log(
	`PACKED_NATIVE_CONSTRAINTS React ${React.version}: schema evidence/authored bounds/decimal any/integer step/text textarea attrs/typed null/host validation independence passed`,
);
