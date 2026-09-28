import { type JsonValue, copyJson } from "@formbar/expressions";
import { type AdmittedComputation, checkKaladaComputationGraph } from "./kalada-computation-graph.js";
import {
	type RecordValue,
	directReference,
	exact,
	identifier,
	list,
	nodeShape,
	object,
	scopeDeclaration,
} from "./kalada-definition-shape.js";
import {
	actionShape,
	oneOf,
	optionalString,
	presentation,
	repeaterBounds,
	requiredId,
	requiredString,
	submission,
} from "./kalada-node-values.js";
import { type AdmittedProgram, ProgramAdmissionError, admitKaladaProgram } from "./kalada-program.js";
import type { ScopeDeclaration, StaticReference } from "./static-references.js";

export interface AdmittedSlot extends AdmittedProgram {
	readonly path: string;
	readonly enclosingScope?: string;
}
export interface AdmittedNode {
	readonly path: string;
	readonly type: string;
	readonly enclosingScope?: string;
}
export interface AdmittedDefinition {
	readonly slots: readonly AdmittedSlot[];
	readonly nodes: ReadonlyMap<string, AdmittedNode>;
	readonly fields: ReadonlyMap<string, AdmittedNode>;
	readonly aliases: ReadonlyMap<string, string>;
	readonly scopes: Readonly<Record<string, ScopeDeclaration>>;
	readonly repeaters: ReadonlyMap<string, string>;
	readonly targets: ReadonlyMap<string, StaticReference>;
	readonly computations: readonly AdmittedComputation[];
}

interface Frame {
	readonly scopes: Record<string, ScopeDeclaration>;
	readonly enclosing?: string;
	readonly result: MutableResult;
}
interface MutableResult {
	readonly slots: AdmittedSlot[];
	readonly nodes: Map<string, AdmittedNode>;
	readonly fields: Map<string, AdmittedNode>;
	readonly aliases: Map<string, string>;
	readonly ids: Map<string, { readonly role: "node" | "alias"; readonly path: string }>;
	readonly scopes: Record<string, ScopeDeclaration>;
	readonly repeaters: Map<string, string>;
	readonly targets: Map<string, StaticReference>;
	readonly computations: AdmittedComputation[];
}

function slot(value: JsonValue | undefined, path: string, frame: Frame): void {
	if (value === undefined) throw new ProgramAdmissionError(path, "REQUIRED_PROGRAM");
	frame.result.slots.push(
		Object.freeze({
			path,
			...admitKaladaProgram(value, path, frame.scopes, frame.enclosing),
			...(frame.enclosing === undefined ? {} : { enclosingScope: frame.enclosing }),
		}),
	);
}

function optional(value: JsonValue | undefined, path: string, frame: Frame): void {
	if (value !== undefined) slot(value, path, frame);
}

function props(value: JsonValue | undefined, path: string, frame: Frame): void {
	if (value === undefined) return;
	for (const [name, raw] of Object.entries(object(value, path))) {
		identifier(name, `${path}.${name}`);
		const propPath = `${path}.${name}`;
		prop(object(raw, propPath), propPath, frame);
	}
}

function prop(source: RecordValue, path: string, frame: Frame): void {
	switch (source.mode) {
		case "read":
			exact(source, ["mode", "expression"], path);
			slot(source.expression, `${path}.expression`, frame);
			return;
		case "write":
			exact(source, ["mode", "reference"], path);
			if (object(source.reference, `${path}.reference`).namespace !== "data")
				throw new ProgramAdmissionError(`${path}.reference`, "INVALID_BINDING");
			frame.result.targets.set(
				`${path}.reference`,
				directReference(source.reference, `${path}.reference`, frame.scopes, frame.enclosing),
			);
			return;
		case "literal":
			exact(source, ["mode", "value"], path);
			if (!Object.hasOwn(source, "value")) throw new ProgramAdmissionError(`${path}.value`, "REQUIRED_VALUE");
			return;
		default:
			throw new ProgramAdmissionError(`${path}.mode`, "INVALID_MODE");
	}
}

function children(value: JsonValue | undefined, path: string, frame: Frame): void {
	for (const [index, child] of list(value, path).entries()) node(child, `${path}[${index}]`, frame);
}

function collections(value: JsonValue | undefined, path: string, frame: Frame): void {
	for (const [index, entry] of list(value, path).entries()) {
		const itemPath = `${path}[${index}]`;
		const source = object(entry, itemPath);
		exact(source, ["id", "label", "children"], itemPath);
		requiredString(source.label, `${itemPath}.label`);
		const id = identifier(source.id, `${itemPath}.id`);
		registerId(frame.result, id, `${itemPath}.id`, "alias");
		children(source.children, `${itemPath}.children`, frame);
	}
}

function registerId(result: MutableResult, id: string, path: string, role: "node" | "alias"): void {
	if (result.ids.has(id))
		throw new ProgramAdmissionError(path, role === "node" ? "DUPLICATE_NODE_ID" : "DUPLICATE_ALIAS");
	result.ids.set(id, { role, path });
	if (role === "alias") result.aliases.set(id, path);
}

function repeater(source: RecordValue, path: string, frame: Frame): void {
	repeaterBounds(source, path);
	const scope = identifier(source.scope, `${path}.scope`);
	if (Object.hasOwn(frame.result.scopes, scope)) throw new ProgramAdmissionError(`${path}.scope`, "DUPLICATE_SCOPE");
	const declaration = scopeDeclaration(source.binding, `${path}.binding`, frame.scopes, frame.enclosing);
	frame.result.targets.set(
		`${path}.binding`,
		directReference(source.binding, `${path}.binding`, frame.scopes, frame.enclosing),
	);
	frame.result.scopes[scope] = declaration;
	frame.result.repeaters.set(path, scope);
	children(source.children, `${path}.children`, {
		...frame,
		enclosing: scope,
		scopes: { ...frame.scopes, [scope]: declaration },
	});
}

function node(value: JsonValue, path: string, frame: Frame): void {
	const source = object(value, path);
	const type = nodeShape(source, path);
	const id = identifier(source.id, `${path}.id`);
	presentation(source.presentation, `${path}.presentation`);
	for (const key of type === "section" ? ["title", "description"] : ["label"])
		optionalString(source[key], `${path}.${key}`);
	if (type === "field") {
		requiredId(source.widget, `${path}.widget`);
		oneOf(source.submitWhenHidden, ["include"], `${path}.submitWhenHidden`);
	}
	if (type === "custom") requiredId(source.renderer, `${path}.renderer`);
	if (type === "output") oneOf(source.format, ["plain", "number", "currency-usd", "percent"], `${path}.format`);
	if (type === "action") actionShape(source, path);
	registerId(frame.result, id, `${path}.id`, "node");
	const info = Object.freeze({
		path,
		type,
		...(frame.enclosing === undefined ? {} : { enclosingScope: frame.enclosing }),
	});
	frame.result.nodes.set(id, info);
	if (type === "field") frame.result.fields.set(id, info);
	for (const key of ["visible", "disabled", "readOnly"]) optional(source[key], `${path}.${key}`, frame);
	if (type === "field") slotField(source, path, frame);
	if (type === "validation") validation(source, path, frame);
	if (type === "output") {
		slot(source.value, `${path}.value`, frame);
		props(source.props, `${path}.props`, frame);
	}
	if (type === "action") {
		optional(source.payload, `${path}.payload`, frame);
		props(source.props, `${path}.props`, frame);
		target(source.target, `${path}.target`, frame);
	}
	if (type === "custom") props(source.props, `${path}.props`, frame);
	if (type === "conditional") {
		slot(source.condition, `${path}.condition`, frame);
		children(source.then, `${path}.then`, frame);
		if (source.else !== undefined) children(source.else, `${path}.else`, frame);
	}
	if (type === "repeater") repeater(source, path, frame);
	if (type === "group" || type === "section") children(source.children, `${path}.children`, frame);
	if (type === "custom" && source.children !== undefined) children(source.children, `${path}.children`, frame);
	if (type === "tabs" || type === "accordion")
		collections(source[type === "tabs" ? "tabs" : "items"], `${path}.${type === "tabs" ? "tabs" : "items"}`, frame);
}

function validation(source: RecordValue, path: string, frame: Frame): void {
	const bindingPath = `${path}.binding`;
	const resolved = directReference(source.binding, bindingPath, frame.scopes, frame.enclosing);
	frame.result.targets.set(bindingPath, resolved);
	if (source.messages === undefined) return;
	for (const [index, message] of list(source.messages, `${path}.messages`).entries()) {
		if (typeof message !== "string") throw new ProgramAdmissionError(`${path}.messages[${index}]`, "INVALID_SHAPE");
	}
}

function target(value: JsonValue | undefined, path: string, frame: Frame): void {
	if (value !== undefined) {
		const ref = directReference(value, path, frame.scopes, frame.enclosing);
		if (path.endsWith(".target") && ref.namespace !== "data")
			throw new ProgramAdmissionError(path, "INVALID_ACTION_TARGET");
		frame.result.targets.set(path, ref);
	}
}

function slotField(source: RecordValue, path: string, frame: Frame): void {
	target(source.binding, `${path}.binding`, frame);
	if (source.binding === undefined) throw new ProgramAdmissionError(`${path}.binding`, "INVALID_BINDING");
	optional(source.required, `${path}.required`, frame);
	props(source.props, `${path}.props`, frame);
}

function admitComputations(value: JsonValue | undefined, frame: Frame): void {
	if (value !== undefined) {
		for (const [index, entry] of list(value, "computations").entries()) {
			const path = `computations[${index}]`;
			const item = object(entry, path);
			exact(item, ["id", "target", "expression"], path);
			const id = identifier(item.id, `${path}.id`);
			const resolved = directReference(item.target, `${path}.target`, frame.scopes, frame.enclosing);
			if (
				resolved.namespace !== "data" ||
				!resolved.path.length ||
				Object.hasOwn(object(item.target, `${path}.target`), "scope")
			)
				throw new ProgramAdmissionError(`${path}.target`, "INVALID_BINDING");
			frame.result.targets.set(`${path}.target`, resolved);
			slot(item.expression, `${path}.expression`, frame);
			frame.result.computations.push(
				Object.freeze({
					id,
					path,
					target: resolved,
					expression: frame.result.slots[frame.result.slots.length - 1] as AdmittedSlot,
				}),
			);
		}
	}
}

function checkFieldReads(result: MutableResult): void {
	for (const slot of result.slots) {
		for (const reference of slot.dependencies) {
			if (reference.namespace !== "field") continue;
			const field = result.fields.get(reference.path[0] as string);
			if (!field) throw new ProgramAdmissionError(slot.path, "INVALID_FIELD_REFERENCE");
			let scope = slot.enclosingScope;
			while (scope !== undefined && scope !== field.enclosingScope) scope = result.scopes[scope]?.parent;
			if (scope !== field.enclosingScope) throw new ProgramAdmissionError(slot.path, "INVALID_FIELD_REFERENCE");
		}
	}
}

/** Private inventory and graph check only; public validation remains Kuery until the atomic V1 switch. */
export function admitKaladaDefinition(input: unknown): AdmittedDefinition {
	let safe: JsonValue;
	try {
		safe = copyJson(input);
	} catch {
		throw new ProgramAdmissionError("", "INVALID_JSON");
	}
	const source = object(safe, "definition");
	exact(source, ["version", "id", "root", "computations", "submission"], "definition");
	submission(source.submission);
	if (source.version !== 1) throw new ProgramAdmissionError("version", "UNSUPPORTED_VERSION");
	identifier(source.id, "id");
	const result: MutableResult = {
		slots: [],
		nodes: new Map(),
		fields: new Map(),
		aliases: new Map(),
		ids: new Map(),
		scopes: Object.create(null),
		repeaters: new Map(),
		targets: new Map(),
		computations: [],
	};
	const frame: Frame = { scopes: Object.create(null), result };
	node(source.root as JsonValue, "root", frame);
	admitComputations(source.computations, frame);
	checkFieldReads(result);
	checkKaladaComputationGraph(result.computations);
	return Object.freeze({
		slots: Object.freeze(result.slots),
		nodes: result.nodes,
		fields: result.fields,
		aliases: result.aliases,
		targets: result.targets,
		computations: Object.freeze(result.computations),
		scopes: Object.freeze(result.scopes),
		repeaters: result.repeaters,
	});
}
