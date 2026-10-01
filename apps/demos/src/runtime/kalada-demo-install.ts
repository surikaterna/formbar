import {
	type CreateKaladaV1HostOptions,
	type JsonValue,
	type KaladaV1Host,
	createKaladaV1Host,
} from "@formbar/declarative";
import { compileDefaultKaladaV1Definition, jsonSchemaProvider, projectSchema } from "@formbar/from-schema";
import type { PlaygroundDocument, PlaygroundExample } from "../playground/contracts";
import { schemaDefaults } from "./kalada-demo-defaults";
import { type ManagedFieldPolicies, managedFieldPolicies, managedPolicyUi } from "./kalada-demo-managed-policy";
import { addNativeEvidence } from "./kalada-demo-native-evidence";
import { demoActions, demoPolicy } from "./kalada-demo-policy";
import { canonicalDefinition } from "./kalada-demo-programs";
import {
	type Node,
	type Path,
	arrayBounds,
	attestSchema,
	schemaNode,
	schemaPaths,
	schemaValidators,
} from "./kalada-demo-schema";
import { createDemoStrategy } from "./kalada-demo-strategy";
import { schemaValueAllowed } from "./kalada-demo-value";
import { resolveTrustedRuntimeProfiles } from "./trusted-runtime-profiles";

type Ref = { namespace: "data"; segments: readonly string[]; scope?: string };
let generation = 0;
export type DemoLifecycle = Pick<CreateKaladaV1HostOptions, "validators" | "scopedValidators">;
const sessions = new WeakMap<KaladaV1Host, ReturnType<typeof createDemoStrategy>>();
const native = new Set([
	"text",
	"number",
	"checkbox",
	"textarea",
	"select",
	"radio",
	"date",
	"time",
	"email",
	"url",
	"tel",
	"password",
	"search",
]);
const object = (value: unknown): value is Node => !!value && typeof value === "object" && !Array.isArray(value);

function valueAuthority(schema: Node, path: Path["path"], value: JsonValue): boolean {
	const node = schemaNode(schema, path);
	return !!node && schemaValueAllowed(node, value);
}

function applySchemaHint(node: Node, field: Node | undefined) {
	if (!field) return;
	const hint = object(field["x-formbar"]) ? field["x-formbar"] : undefined;
	if (typeof hint?.widget === "string") {
		node.type = "field";
		node.widget = hint.widget;
		for (const name of ["children", "scope", "minItems", "maxItems"]) delete node[name];
		if (object(hint.props))
			node.props = {
				...(object(node.props) ? node.props : {}),
				...Object.fromEntries(Object.entries(hint.props).map(([name, value]) => [name, { mode: "literal", value }])),
			};
	} else if (node.type === "field" && typeof field.format === "string") {
		const format = { email: "email", date: "date", time: "time", uri: "url" }[field.format];
		if (format) node.widget = format;
	}
}

function addAuthoredChoices(definition: Node, schema: Node, generated = false): Node {
	const copy = structuredClone(definition);
	const traverse = (node: Node, at: string, scopes: Scopes) => {
		const ref = node.binding as Ref | undefined;
		const path = ref ? [...(ref.scope ? (scopes[ref.scope] ?? []) : []), ...ref.segments] : [];
		if (generated && ref && ["field", "repeater"].includes(String(node.type)))
			applySchemaHint(node, schemaNode(schema, path));
		if (ref) addNativeEvidence(node, schemaNode(schema, path));
		if (
			node.type === "field" &&
			ref &&
			(node.widget === "select" || node.widget === "radio" || String(node.widget).startsWith("demo16."))
		) {
			const field = schemaNode(schema, path);
			const choices = field?.type === "array" && object(field.items) ? field.items.enum : field?.enum;
			if (Array.isArray(choices) && !(object(node.props) && node.props.options))
				node.props = {
					...(object(node.props) ? node.props : {}),
					options: { mode: "literal", value: choices.map((value) => ({ value, title: String(value) })) },
				};
			if (String(node.widget).startsWith("demo16."))
				node.props = {
					...(object(node.props) ? node.props : {}),
					label: { mode: "literal", value: node.label ?? node.id },
				};
		}
		const next =
			node.type === "repeater" && typeof node.scope === "string"
				? { ...scopes, [node.scope]: [...path, { row: node.scope }] }
				: scopes;
		visitChildren(node, at, next, traverse);
	};
	if (object(copy.root)) traverse(copy.root, "root", {});
	return copy;
}

function directWriter(ref: Ref, primitive?: "string" | "number" | "integer" | "boolean") {
	return {
		source: primitive ? "line" : "value",
		location: {
			[primitive ? "line" : "value"]: {
				target: {
					namespace: "data",
					segments: ref.segments,
					...(ref.scope ? { scope: ref.scope } : {}),
				},
				type: { kind: "primitive-type", name: primitive ?? "json" },
				writable: true,
			},
			...(primitive ? { primitiveItem: { scope: ref.scope, type: primitive, writable: true } } : {}),
		},
	};
}

type Collected = {
	paths: Path[];
	writeSources: Record<string, string>;
	directLocations: Record<string, Record<string, unknown>>;
	widgets: Set<string>;
	fieldPaths: Record<string, Path["path"]>;
};
type Scopes = Readonly<Record<string, readonly (string | { row: string })[]>>;

function registerBinding(node: Node, at: string, scopes: Scopes, result: Collected, schema: Node): Scopes {
	const ref = node.binding as Ref | undefined;
	if (!ref) return scopes;
	if (ref.namespace !== "data" || !Array.isArray(ref.segments) || ref.segments.some((part) => typeof part !== "string"))
		throw new TypeError(`${at}.binding: UNSUPPORTED_V1_RE-AUTHOR`);
	if (ref.scope && !scopes[ref.scope]) throw new TypeError(`${at}.binding: UNKNOWN_SCOPE`);
	const path = [...(ref.scope ? (scopes[ref.scope] ?? []) : []), ...ref.segments];
	const kind = node.type === "repeater" ? "array" : "value";
	if (!result.paths.some((entry) => entry.kind === kind && JSON.stringify(entry.path) === JSON.stringify(path)))
		result.paths.push({ path, kind });
	if (node.type === "field") {
		const property = ref.segments.at(-1);
		const item = schemaNode(schema, path);
		const primitive =
			ref.scope && ref.segments.length === 0 && ["string", "number", "integer", "boolean"].includes(String(item?.type))
				? (item?.type as "string" | "number" | "integer" | "boolean")
				: undefined;
		if ((!property && !primitive) || (property && ["__proto__", "constructor", "prototype"].includes(property)))
			throw new TypeError(`${at}.binding: UNSUPPORTED_WRITE_TARGET_RE-AUTHOR`);
		const writer = directWriter(ref, primitive);
		result.fieldPaths[at] = path;
		result.writeSources[`${at}.binding`] = writer.source;
		result.directLocations[`${at}.binding`] = writer.location;
		result.widgets.add(String(node.widget));
	}
	if (node.type !== "repeater") return scopes;
	if (typeof node.scope !== "string") throw new TypeError(`${at}.scope: MISSING_SCOPE`);
	return { ...scopes, [node.scope]: [...path, { row: node.scope }] };
}

function visitChildren(
	node: Node,
	at: string,
	scopes: Scopes,
	visit: (node: Node, at: string, scopes: Scopes) => void,
) {
	for (const branch of ["children", "then", "else"]) {
		const children = node[branch];
		if (Array.isArray(children))
			children.forEach((child, index) => {
				if (object(child)) visit(child, `${at}.${branch}[${index}]`, scopes);
			});
	}
	for (const group of ["tabs", "items"]) {
		const items = node[group];
		if (Array.isArray(items))
			items.forEach((item, index) => {
				if (object(item) && Array.isArray(item.children))
					item.children.forEach((child, childIndex) => {
						if (object(child)) visit(child, `${at}.${group}[${index}].children[${childIndex}]`, scopes);
					});
			});
	}
}

function collect(definition: Node, schema: Node) {
	const result: Collected = { paths: [], writeSources: {}, directLocations: {}, widgets: new Set(), fieldPaths: {} };
	const walk = (node: Node, at: string, scopes: Scopes) =>
		visitChildren(node, at, registerBinding(node, at, scopes, result, schema), walk);
	if (!object(definition.root)) throw new TypeError("root: INVALID_DEFINITION");
	walk(definition.root, "root", {});
	return result;
}

function definitionFor(document: PlaygroundDocument, managedFields: ManagedFieldPolicies) {
	const definition =
		document.definition === null
			? compileDefaultKaladaV1Definition(
					projectSchema(
						// Generated controls may only address explicitly attested properties, not open-ended schema keys.
						{ ...document.schema, additionalProperties: false },
						{ provider: jsonSchemaProvider(), side: "input" },
					).descriptors,
				)
			: document.definition;
	if (!object(definition)) throw new TypeError("definition: INVALID_DEFINITION");
	return document.definition === null
		? { definition: addAuthoredChoices(definition, document.schema, true), uiPaths: [] as string[][] }
		: canonicalDefinition(addAuthoredChoices(definition, document.schema), managedFields);
}

export function installDemo(
	document: PlaygroundDocument,
	onSubmit?: (payload: Readonly<Record<string, unknown>>) => void,
	profileIds: readonly string[] = ["formbar.standard.v1"],
	initialUiState: Readonly<Record<string, unknown>> = {},
	arbiterRules?: PlaygroundExample["runtime"]["arbiterRules"],
	lifecycle: DemoLifecycle = {},
) {
	return installDemoSession(document, onSubmit, profileIds, undefined, initialUiState, arbiterRules, lifecycle);
}

export function disposeDemoSession(host: KaladaV1Host): void {
	host.dispose();
	sessions.get(host)?.revoke();
}

function prepareInstallation(
	document: PlaygroundDocument,
	profileIds: readonly string[],
	arbiterRules?: PlaygroundExample["runtime"]["arbiterRules"],
	lifecycle: DemoLifecycle = {},
) {
	const profiles = resolveTrustedRuntimeProfiles(profileIds);
	if (!profiles.ok) throw new TypeError(`Trusted runtime profile rejected: ${JSON.stringify(profiles.diagnostics)}`);
	const schema = document.schema;
	const fields = managedFieldPolicies(profileIds.includes("formbar.arbiter.v1") ? arbiterRules : undefined);
	const { definition, uiPaths } = definitionFor(document, fields);
	const collected = collect(definition, schema);
	const { paths, widgets } = collected;
	const authorizedPaths = [
		...paths,
		...schemaPaths(schema).filter(
			(candidate) => !paths.some((entry) => JSON.stringify(entry.path) === JSON.stringify(candidate.path)),
		),
	];
	const identity = Object.freeze({
		generation: `demo-v1-${++generation}`,
		fingerprint: `demo-local-${profileIds.join(":")}`,
	});
	attestSchema(schema, paths);
	const { policy, trustedWidgets, trustedRenderers } = demoPolicy(identity, profiles, authorizedPaths, uiPaths);
	for (const widget of widgets)
		if (!native.has(widget) && !trustedWidgets.has(widget))
			throw new TypeError(`widget ${widget}: MISSING_TRUSTED_RENDERER_RE-AUTHOR`);
	const owned = schemaValidators(schema);
	const configuration = initialAuthority(schema, definition, uiPaths, authorizedPaths, owned[0]);
	return {
		profiles,
		fields,
		definition,
		identity,
		authorizedPaths,
		...collected,
		policy,
		configuration,
		trustedRenderers,
		validators: [...owned, ...(lifecycle.validators ?? [])],
		scopedValidators: lifecycle.scopedValidators ?? [],
	};
}

function initialAuthority(
	schema: Node,
	definition: Node,
	uiPaths: readonly string[][],
	paths: readonly Path[],
	schemaValidator: ReturnType<typeof schemaValidators>[number] | undefined,
) {
	return { schema, definition, uiPaths, arrayBounds: arrayBounds(schema, paths), schemaValidator };
}

function acquireSession(
	setup: ReturnType<typeof prepareInstallation>,
	schema: Node,
	profileIds: readonly string[],
	previous: KaladaV1Host | undefined,
	initialUiState: Readonly<Record<string, unknown>>,
	arbiterRules: PlaygroundExample["runtime"]["arbiterRules"] | undefined,
	onSubmit?: (payload: Readonly<Record<string, unknown>>) => void,
) {
	const { identity, authorizedPaths, fieldPaths, fields, configuration } = setup;
	const store = previous
		? sessions.get(previous)
		: createDemoStrategy(
				identity,
				authorizedPaths,
				fieldPaths,
				(ref, value) => valueAuthority(schema, ref.path, value),
				(payload) => {
					if (object(payload)) onSubmit?.(payload);
				},
				{ ...initialUiState, ...managedPolicyUi(fields) },
				profileIds.includes("formbar.arbiter.v1") ? arbiterRules : undefined,
				configuration,
			);
	if (!store) throw new TypeError("Previous demo strategy unavailable");
	const session = previous
		? store.reinstall(
				identity,
				authorizedPaths,
				fieldPaths,
				(ref, value) => valueAuthority(schema, ref.path, value),
				{ ...initialUiState, ...managedPolicyUi(fields) },
				profileIds.includes("formbar.arbiter.v1") ? arbiterRules : undefined,
				configuration,
			)
		: store;
	return { store, session };
}

export function installDemoSession(
	document: PlaygroundDocument,
	onSubmit?: (payload: Readonly<Record<string, unknown>>) => void,
	profileIds: readonly string[] = ["formbar.standard.v1"],
	previous?: KaladaV1Host,
	initialUiState: Readonly<Record<string, unknown>> = {},
	arbiterRules?: PlaygroundExample["runtime"]["arbiterRules"],
	lifecycle: DemoLifecycle = {},
) {
	const setup = prepareInstallation(document, profileIds, arbiterRules, lifecycle);
	const { store, session } = acquireSession(
		setup,
		document.schema,
		profileIds,
		previous,
		initialUiState,
		arbiterRules,
		onSubmit,
	);
	const host: KaladaV1Host = createKaladaV1Host({
		definition: setup.definition,
		policy: setup.policy,
		identity: setup.identity,
		strategy: session.strategy,
		writeSources: setup.writeSources,
		directLocations: setup.directLocations as CreateKaladaV1HostOptions["directLocations"],
		installed: {
			widgets: setup.widgets,
			renderers: setup.trustedRenderers,
			arrayHost: session.arrayHost,
			actions: demoActions(setup.profiles, () => host),
		},
		...(!previous
			? { initialization: { defaults: schemaDefaults(document.schema), overrides: document.initialData as JsonValue } }
			: {}),
		validators: setup.validators,
		scopedValidators: setup.scopedValidators,
	});
	sessions.set(host, store);
	return host;
}
