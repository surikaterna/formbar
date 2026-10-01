import assert from "node:assert/strict";
import { type CreateKaladaV1HostOptions, type JsonValue, createKaladaV1Host } from "@formbar/declarative";
import { createKaladaSchemaForm, jsonSchemaProvider } from "@formbar/from-schema";
import { initialTypeAllowed } from "../../../apps/demos/src/runtime/kalada-demo-initial-types";
import { initializeDemo } from "../../../apps/demos/src/runtime/kalada-demo-initialize";
import { demoIdentity } from "../../../apps/demos/src/runtime/kalada-demo-reads";
import { schemaNode, schemaValidators } from "../../../apps/demos/src/runtime/kalada-demo-schema";
import { DemoSession } from "../../../apps/demos/src/runtime/kalada-demo-session";
import { DemoStore } from "../../../apps/demos/src/runtime/kalada-demo-store";
import { createDemoStrategy } from "../../../apps/demos/src/runtime/kalada-demo-strategy";

export const initialSchema = {
	type: "object",
	additionalProperties: false,
	properties: {
		address: {
			type: "object",
			additionalProperties: false,
			default: { city: "Paris", zip: "75000" },
			properties: { city: { type: "string", default: "Paris" }, zip: { type: "string", default: "75000" } },
		},
		flag: { type: "boolean", default: true },
		count: { type: "number", default: 9 },
		text: { type: "string", default: "fallback" },
		nullable: { enum: ["fallback", null], default: "fallback" },
		spare: { type: "string" },
		rows: {
			type: "array",
			default: [{}],
			items: { type: "object", additionalProperties: false, properties: { code: { type: "string", default: "B" } } },
		},
	},
};
const identity = { generation: "initialization", fingerprint: "owned" };
const refs = [["address", "city"], ["address", "zip"], ["flag"], ["count"], ["text"], ["spare"]];
const reference = (segments: readonly string[], scope?: string) => ({
	namespace: "data" as const,
	segments,
	...(scope ? { scope } : {}),
});
const program = (segments: readonly string[], scope?: string) => ({
	format: "kalada-program",
	version: 1,
	profile: "kalada-v1",
	expression: { kind: "ref", ref: reference(segments, scope) },
});
const definition = {
	version: 1,
	id: "initialization",
	root: {
		type: "group",
		id: "root",
		children: [
			...refs.map((path, i) => ({
				type: "field",
				id: `field-${i}`,
				widget: i === 2 ? "checkbox" : i === 3 ? "number" : "text",
				binding: reference(path),
			})),
			{ type: "output", id: "nullable", value: program(["nullable"]) },
			{
				type: "repeater",
				id: "rows",
				scope: "row",
				binding: reference(["rows"]),
				children: [{ type: "output", id: "code", value: program(["code"], "row") }],
			},
		],
	},
};
const paths = [
	...refs.map((path) => ({ path, kind: "value" as const })),
	{ path: ["address"], kind: "value" as const },
	{ path: ["nullable"], kind: "value" as const },
	{ path: ["rows"], kind: "array" as const },
	{ path: ["rows", { row: "row" }, "code"], kind: "value" as const },
];
const fields = Object.fromEntries(refs.map((path, i) => [`root.children[${i}]`, path]));
const defaults = [
	{ path: ["address"], value: { city: "Paris", zip: "75000" } },
	{ path: ["address", "city"], value: "Paris" },
	{ path: ["address", "zip"], value: "75000" },
	{ path: ["flag"], value: true },
	{ path: ["count"], value: 9 },
	{ path: ["text"], value: "fallback" },
	{ path: ["nullable"], value: "fallback" },
	{ path: ["rows"], value: [{}] },
	{ path: ["rows", "*", "code"], value: "B" },
];
function allowed(ref: { path: readonly (string | number | { row: string })[] }, value: JsonValue) {
	const node = schemaNode(initialSchema, ref.path as readonly (string | { row: string })[]);
	return !!node && initialTypeAllowed(node, value);
}

export function publicInitializationFixture() {
	const submitted: JsonValue[] = [];
	const ports = createDemoStrategy(identity, paths, fields, allowed, (value) => submitted.push(value), {}, undefined, {
		definition,
		schema: initialSchema,
	});
	const calls = { identity: 0, initialize: 0 };
	const strategy = {
		...ports.strategy,
		identity(context: Parameters<typeof ports.strategy.identity>[0]) {
			calls.identity++;
			return ports.strategy.identity(context);
		},
		initializeSchema(
			context: Parameters<NonNullable<typeof ports.strategy.initializeSchema>>[0],
			request: Parameters<NonNullable<typeof ports.strategy.initializeSchema>>[1],
		) {
			calls.initialize++;
			assert.equal(request.instance, context.instance);
			assert.equal(request.revision, ports.strategy.current(context));
			return ports.strategy.initializeSchema?.(context, request) ?? { status: "denied" as const };
		},
	};
	const options = {
		identity,
		definition,
		strategy,
		policy: {
			...identity,
			widgets: {},
			renderers: {},
			actions: {},
			namespaces: { data: "available" },
			schema: { side: "input" as const, availability: "complete" as const, paths },
			ui: { availability: "complete" as const, paths: [] },
		},
		writeSources: Object.fromEntries(refs.map((_path, i) => [`root.children[${i}].binding`, "value"])),
		directLocations: Object.fromEntries(
			refs.map((path, i) => [
				`root.children[${i}].binding`,
				{
					value: {
						target: reference(path),
						type: { kind: "primitive-type" as const, name: "json" as const },
						writable: true as const,
					},
				},
			]),
		),
	};
	return {
		calls,
		submitted,
		installOwner(mode: "host" | "schema", owner: object) {
			const supplied = Object.defineProperties(
				{ ...options, provider: jsonSchemaProvider(), side: "input" as const },
				Object.getOwnPropertyDescriptors(owner),
			);
			return mode === "host" ? createKaladaV1Host(supplied) : createKaladaSchemaForm(initialSchema, supplied).host;
		},
		install(mode: "host" | "schema", overrides?: unknown, inputDefaults: unknown = defaults) {
			return mode === "schema"
				? createKaladaSchemaForm(initialSchema, {
						...options,
						provider: jsonSchemaProvider(),
						side: "input",
						...(overrides === undefined ? {} : { initialData: overrides as JsonValue }),
					}).host
				: createKaladaV1Host({
						...options,
						validators: schemaValidators(initialSchema),
						initialization: { defaults: inputDefaults, ...(overrides === undefined ? {} : { overrides }) },
					} as CreateKaladaV1HostOptions);
		},
		dispose() {
			ports.revoke();
		},
	};
}

export function directInitializationFixture() {
	const store = new DemoStore();
	store.data = {
		address: { city: "Old", zip: "old" },
		flag: true,
		count: 4,
		text: "original",
		nullable: "fallback",
		rows: [{ code: "existing" }],
	};
	store.initial = structuredClone(store.data);
	store.revision = Object.freeze({ opaque: Symbol("revision") });
	store.rowsAt(["rows"]);
	let notifications = 0;
	store.subscribers.add(() => notifications++);
	const validator = () => [];
	const origin = {};
	store.issueRecords = [{ path: ["text"], message: "existing issue", source: "schema", validator, origin, ordinal: 0 }];
	store.syncStatus();
	let hook: (() => void) | undefined;
	const session = new DemoSession(store, {
		identity,
		paths,
		fields,
		definition,
		schema: initialSchema,
		valueAllowed(ref, value) {
			hook?.();
			return allowed(ref, value);
		},
	});
	const context = {
		instance: new Map([["opaque", () => 1]]),
		policyGeneration: identity.generation,
		policyFingerprint: identity.fingerprint,
	};
	demoIdentity(session, context);
	return {
		store,
		session,
		context,
		notifications: () => notifications,
		hook(next?: () => void) {
			hook = next;
		},
		initialize(overrides: unknown, inputDefaults: unknown = [], revision = store.revision) {
			return initializeDemo(session, context, {
				contract: "formbar-schema-initialization-v1",
				instance: context.instance,
				revision,
				defaults: inputDefaults,
				overrides,
			} as Parameters<typeof initializeDemo>[2]);
		},
		dispose() {
			session.revoke();
		},
	};
}
