import { type JsonValue, copyJson } from "@formbar/expressions";
import { type PathAuthority, validatePathAuthority } from "./kalada-path-authority.js";
import { ProgramAdmissionError } from "./kalada-program.js";

// Private host-supplied evidence, not a renderer/action registry or a source-installable profile.
export interface AdmissionPolicy {
	readonly generation: string;
	readonly fingerprint: string;
	readonly widgets: Readonly<Record<string, ExtensionRule>>;
	readonly renderers: Readonly<Record<string, ExtensionRule>>;
	readonly actions: Readonly<Record<string, ExtensionRule>>;
	readonly namespaces: Readonly<Record<string, "available" | "unavailable">>;
	readonly schema: Readonly<{
		readonly side: "input" | "output";
		readonly availability: "complete" | "partial" | "unavailable";
		readonly paths: PathAuthority["paths"];
	}>;
	readonly ui: PathAuthority;
}

export interface ExtensionRule {
	readonly children: "allowed" | "forbidden";
	readonly props: Readonly<Record<string, PropRule>>;
}

export interface PropRule {
	readonly modes: readonly ("literal" | "read" | "write")[];
	readonly expected: "json" | "string" | "number" | "boolean" | "null" | "array" | "object";
}

export interface PolicyIdentity {
	readonly generation: string;
	readonly fingerprint: string;
}

const reserved = new Set(["__proto__", "prototype", "constructor"]);
export const nativeWidgets: ReadonlySet<string> = new Set([
	"text",
	"textarea",
	"number",
	"select",
	"checkbox",
	"radio",
	"date",
	"time",
	"email",
	"url",
	"tel",
	"password",
	"search",
	"unsupported",
]);
export const builtInActions: ReadonlySet<string> = new Set([
	"submit",
	"reset",
	"validate",
	"array.append",
	"array.insert",
	"array.remove",
	"array.move",
	"array.swap",
]);

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function id(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 256 && !reserved.has(value);
}

function keys(value: unknown, path: string, allowed: readonly string[]): asserts value is Record<string, unknown> {
	if (!record(value) || Object.keys(value).some((key) => !allowed.includes(key)))
		throw new ProgramAdmissionError(path, "INVALID_POLICY");
}

function validateRules(value: unknown, path: string, blocked: ReadonlySet<string>): void {
	if (!record(value)) throw new ProgramAdmissionError(path, "INVALID_POLICY");
	for (const [name, raw] of Object.entries(value)) {
		if (!id(name) || blocked.has(name)) throw new ProgramAdmissionError(`${path}.${name}`, "INVALID_POLICY");
		keys(raw, `${path}.${name}`, ["children", "props"]);
		if (raw.children !== "allowed" && raw.children !== "forbidden")
			throw new ProgramAdmissionError(`${path}.${name}.children`, "INVALID_POLICY");
		if (!record(raw.props)) throw new ProgramAdmissionError(`${path}.${name}.props`, "INVALID_POLICY");
		for (const [prop, spec] of Object.entries(raw.props)) {
			const at = `${path}.${name}.props.${prop}`;
			if (!id(prop)) throw new ProgramAdmissionError(at, "INVALID_POLICY");
			keys(spec, at, ["modes", "expected"]);
			if (
				!Array.isArray(spec.modes) ||
				!spec.modes.length ||
				new Set(spec.modes).size !== spec.modes.length ||
				spec.modes.some((mode) => !["literal", "read", "write"].includes(mode))
			)
				throw new ProgramAdmissionError(`${at}.modes`, "INVALID_POLICY");
			if (!["json", "string", "number", "boolean", "null", "array", "object"].includes(String(spec.expected)))
				throw new ProgramAdmissionError(`${at}.expected`, "INVALID_POLICY");
		}
	}
}

function freezeDeep<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freezeDeep(child);
		Object.freeze(value);
	}
	return value;
}

/** Copy untrusted host metadata to inert data; never retain executable registrations or callbacks. */
export function snapshotAdmissionPolicy(input: unknown): AdmissionPolicy {
	let safe: JsonValue;
	try {
		safe = copyJson(input);
	} catch {
		throw new ProgramAdmissionError("policy", "INVALID_POLICY");
	}
	keys(safe, "policy", ["generation", "fingerprint", "widgets", "renderers", "actions", "namespaces", "schema", "ui"]);
	if (!id(safe.generation) || !id(safe.fingerprint)) throw new ProgramAdmissionError("policy", "INVALID_POLICY");
	validateRules(safe.widgets, "policy.widgets", nativeWidgets);
	validateRules(safe.renderers, "policy.renderers", reserved);
	validateRules(safe.actions, "policy.actions", builtInActions);
	if (!record(safe.namespaces)) throw new ProgramAdmissionError("policy.namespaces", "INVALID_POLICY");
	for (const [name, status] of Object.entries(safe.namespaces))
		if (!id(name) || !["available", "unavailable"].includes(String(status)))
			throw new ProgramAdmissionError(`policy.namespaces.${name}`, "INVALID_POLICY");
	keys(safe.schema, "policy.schema", ["side", "availability", "paths"]);
	if (
		!["input", "output"].includes(String(safe.schema.side)) ||
		!["complete", "partial", "unavailable"].includes(String(safe.schema.availability))
	)
		throw new ProgramAdmissionError("policy.schema", "INVALID_POLICY");
	validatePathAuthority({ availability: safe.schema.availability, paths: safe.schema.paths }, "policy.schema");
	validatePathAuthority(safe.ui, "policy.ui");
	return freezeDeep(safe) as unknown as AdmissionPolicy;
}

function matches(value: unknown, expected: PropRule["expected"]): boolean {
	if (expected === "json") return true;
	if (expected === "null") return value === null;
	if (expected === "array") return Array.isArray(value);
	if (expected === "object") return record(value);
	return (
		(expected === "string" && typeof value === "string") ||
		(expected === "number" && typeof value === "number") ||
		(expected === "boolean" && typeof value === "boolean")
	);
}

// Own data descriptors avoid executing ordinary accessors; arbitrary Proxy traps remain outside this guarantee.
function ownData(value: object, key: string, path: string, code: string): PropertyDescriptor {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new ProgramAdmissionError(path, code);
	return descriptor;
}

const standardPrototypeKeys = new Set<PropertyKey>([
	"constructor",
	"__defineGetter__",
	"__defineSetter__",
	"hasOwnProperty",
	"__lookupGetter__",
	"__lookupSetter__",
	"isPrototypeOf",
	"propertyIsEnumerable",
	"toString",
	"valueOf",
	"__proto__",
	"toLocaleString",
]);

function declarationKeys(value: object, path: string, code: string): PropertyKey[] {
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== null && prototype !== Object.prototype) {
		const inherited = Reflect.ownKeys(prototype)[0];
		const key = String(inherited ?? "__proto__");
		throw new ProgramAdmissionError(`${path}.${key}`, key === "mode" ? "FORBIDDEN_PROP_MODE" : code);
	}
	if (prototype === Object.prototype) {
		for (const key of Reflect.ownKeys(prototype))
			if (!standardPrototypeKeys.has(key)) throw new ProgramAdmissionError(`${path}.${String(key)}`, code);
	}
	return Reflect.ownKeys(value);
}

function declarationData(value: object, key: string, path: string, code: string): PropertyDescriptor {
	const descriptor = ownData(value, key, path, code);
	if (!descriptor.enumerable) throw new ProgramAdmissionError(path, code);
	return descriptor;
}

function checkDeclarationProp(spec: unknown, allowed: PropRule, at: string): void {
	if (!record(spec)) throw new ProgramAdmissionError(`${at}.mode`, "FORBIDDEN_PROP_MODE");
	for (const key of declarationKeys(spec, at, "INVALID_PROP_TYPE")) {
		const field = `${at}.${String(key)}`;
		if (key !== "mode" && key !== "value") throw new ProgramAdmissionError(field, "INVALID_PROP_TYPE");
		declarationData(spec, key, field, key === "mode" ? "FORBIDDEN_PROP_MODE" : "INVALID_PROP_TYPE");
	}
	const mode = declarationData(spec, "mode", `${at}.mode`, "FORBIDDEN_PROP_MODE").value;
	if (!allowed.modes.includes(mode as "literal" | "read" | "write"))
		throw new ProgramAdmissionError(`${at}.mode`, "FORBIDDEN_PROP_MODE");
	if (mode !== "literal") return;
	const valueDescriptor = Object.getOwnPropertyDescriptor(spec, "value");
	if (!valueDescriptor) throw new ProgramAdmissionError(`${at}.value`, "INVALID_PROP_TYPE");
	let value: JsonValue;
	try {
		value = copyJson(valueDescriptor.value);
	} catch {
		throw new ProgramAdmissionError(`${at}.value`, "INVALID_PROP_TYPE");
	}
	if (!matches(value, allowed.expected)) throw new ProgramAdmissionError(`${at}.value`, "INVALID_PROP_TYPE");
}

/** Checks one declaration only. Tree traversal, runtime authorization and prop projection are separate work. */
export function checkPolicyDeclaration(
	policy: AdmissionPolicy,
	identity: PolicyIdentity,
	kind: "widget" | "renderer" | "action",
	name: string,
	path: string,
	props: Readonly<Record<string, { readonly mode: string; readonly value?: JsonValue }>> = {},
	hasChildren = false,
): void {
	if (
		!id(identity.generation) ||
		!id(identity.fingerprint) ||
		policy.generation !== identity.generation ||
		policy.fingerprint !== identity.fingerprint
	)
		throw new ProgramAdmissionError(path, "STALE_POLICY");
	const reservedId = kind === "widget" ? nativeWidgets : kind === "action" ? builtInActions : reserved;
	if (!id(name) || reservedId.has(name)) throw new ProgramAdmissionError(path, "RESERVED_ID");
	const entries = kind === "widget" ? policy.widgets : kind === "action" ? policy.actions : policy.renderers;
	const rule = Object.hasOwn(entries, name) ? entries[name] : undefined;
	if (!rule) throw new ProgramAdmissionError(path, "MISSING_POLICY");
	if (hasChildren && rule.children !== "allowed")
		throw new ProgramAdmissionError(`${path}.children`, "FORBIDDEN_CHILDREN");
	if (!record(props)) throw new ProgramAdmissionError(`${path}.props`, "INVALID_PROP_TYPE");
	for (const prop of declarationKeys(props, `${path}.props`, "INVALID_PROP_TYPE")) {
		const at = `${path}.props.${String(prop)}`;
		if (typeof prop !== "string" || !id(prop)) throw new ProgramAdmissionError(at, "INVALID_PROP_TYPE");
		const spec = declarationData(props, prop, at, "INVALID_PROP_TYPE").value as unknown;
		const allowed = Object.hasOwn(rule.props, prop) ? rule.props[prop] : undefined;
		if (!allowed) throw new ProgramAdmissionError(at, "MISSING_POLICY");
		checkDeclarationProp(spec, allowed, at);
	}
}

export function checkPolicyNamespace(
	policy: AdmissionPolicy,
	identity: PolicyIdentity,
	name: string,
	path: string,
): void {
	if (policy.generation !== identity.generation || policy.fingerprint !== identity.fingerprint)
		throw new ProgramAdmissionError(path, "STALE_POLICY");
	if (!id(name) || !Object.hasOwn(policy.namespaces, name) || policy.namespaces[name] !== "available")
		throw new ProgramAdmissionError(path, "MISSING_NAMESPACE_POLICY");
}

export function checkPolicySchemaSide(
	policy: AdmissionPolicy,
	identity: PolicyIdentity,
	side: "input" | "output",
	path: string,
): void {
	if (policy.generation !== identity.generation || policy.fingerprint !== identity.fingerprint)
		throw new ProgramAdmissionError(path, "STALE_POLICY");
	if (policy.schema.side !== side || policy.schema.availability !== "complete")
		throw new ProgramAdmissionError(path, "MISSING_SCHEMA_POLICY");
}
