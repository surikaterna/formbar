import type { JsonValue } from "@formbar/declarative";
import { copyJson } from "@formbar/expressions";
import { initialTypeAllowed } from "./kalada-demo-initial-types";
import { schemaNode } from "./kalada-demo-schema";
import type { DemoSession } from "./kalada-demo-session";
import { DemoStore, type Path, type Reference } from "./kalada-demo-store";
const safeName = (value: unknown) =>
	typeof value === "string" &&
	value.length > 0 &&
	value.length <= 256 &&
	!["__proto__", "constructor", "prototype"].includes(value);

export function ownInitialValue(owner: object, name: string): unknown {
	const property = Object.getOwnPropertyDescriptor(owner, name);
	if (!property) {
		if (name in owner) throw new TypeError("Inherited initialization property");
		return undefined;
	}
	if (!("value" in property)) throw new TypeError("Initialization accessor");
	return property.value;
}

export function captureInitialPayload(request: object) {
	return copyJson({
		defaults: ownInitialValue(request, "defaults"),
		...(Object.hasOwn(request, "overrides") ? { overrides: ownInitialValue(request, "overrides") } : {}),
	}) as Readonly<Record<string, JsonValue>>;
}

function matches(path: Reference["path"], concrete: readonly (string | number)[], prefix = false) {
	return (
		(prefix ? path.length >= concrete.length : path.length === concrete.length) &&
		concrete.every((part, i) => (typeof part === "number" ? typeof path[i] === "object" : part === path[i]))
	);
}

function defaultPaths(store: DemoStore, path: readonly string[], prefix: Path = []): Path[] {
	if (!path.length) return [prefix];
	const [part, ...rest] = path;
	if (part !== "*") {
		const parent = store.get(prefix);
		if (parent !== undefined && (!parent || typeof parent !== "object" || Array.isArray(parent))) return [];
		return defaultPaths(store, rest, [...prefix, part as string]);
	}
	const array = store.get(prefix);
	return Array.isArray(array) ? array.flatMap((_value, i) => defaultPaths(store, rest, [...prefix, i])) : [];
}

function putDefault(candidate: DemoStore, path: Path, value: JsonValue) {
	if (!path.length) {
		candidate.data = structuredClone(value);
		return;
	}
	let cursor = candidate.data as Record<string | number, JsonValue>;
	for (const part of path.slice(0, -1)) {
		if (!Object.hasOwn(cursor, part)) cursor[part] = {};
		cursor = cursor[part] as Record<string | number, JsonValue>;
	}
	cursor[path[path.length - 1] as string | number] = structuredClone(value);
}

function applyDefault(session: DemoSession, candidate: DemoStore, raw: JsonValue) {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("Invalid default");
	const entry = raw as Record<string, JsonValue>;
	if (
		!Array.isArray(entry.path) ||
		entry.path.length > 64 ||
		!entry.path.every((part) => part === "*" || safeName(part)) ||
		!Object.hasOwn(entry, "value") ||
		Object.keys(entry).some((key) => key !== "path" && key !== "value")
	)
		throw new TypeError("Invalid default path");
	const template = entry.path as readonly string[];
	if (session.authority.schema) {
		const node = schemaNode(
			session.authority.schema,
			template.map((part) => (part === "*" ? { row: "template" } : part)),
		);
		if (!node || !initialTypeAllowed(node, entry.value as JsonValue, "default"))
			throw new TypeError("Invalid default schema type");
	}
	if (
		!session.authority.paths.some(
			(item) =>
				template.every((part, i) => (part === "*" ? typeof item.path[i] === "object" : item.path[i] === part)) &&
				item.path.length >= template.length,
		)
	)
		throw new TypeError("Unattested default");
	for (const path of defaultPaths(candidate, template)) {
		const present = candidate.get(path);
		if (
			present !== undefined &&
			!(
				path.length === 0 &&
				present &&
				typeof present === "object" &&
				!Array.isArray(present) &&
				Object.keys(present).length === 0
			)
		)
			continue;
		putDefault(candidate, path, entry.value as JsonValue);
	}
}

export function stageInitialData(session: DemoSession, payload: Readonly<Record<string, JsonValue>>) {
	if (!Array.isArray(payload.defaults)) throw new TypeError("Invalid defaults");
	const candidate = new DemoStore();
	candidate.data = structuredClone(copyJson(session.store.data));
	for (const entry of payload.defaults) applyDefault(session, candidate, entry);
	if (Object.hasOwn(payload, "overrides")) {
		const overrides = payload.overrides as JsonValue;
		if (
			overrides &&
			typeof overrides === "object" &&
			!Array.isArray(overrides) &&
			candidate.data &&
			typeof candidate.data === "object" &&
			!Array.isArray(candidate.data)
		)
			candidate.data = { ...candidate.data, ...structuredClone(overrides) };
		else candidate.data = structuredClone(overrides);
	}
	return candidate.data;
}

export function validateInitialPaths(session: DemoSession, value: JsonValue, path: Path = []) {
	const exact = session.authority.paths.find((entry) => matches(entry.path, path));
	if (exact?.kind === "value" && !initialValueAllowed(session, exact.path, value))
		throw new TypeError("Invalid initial value");
	if (path.length && !session.authority.paths.some((entry) => matches(entry.path, path, true)))
		throw new TypeError("Unattested initial data");
	if (Array.isArray(value)) {
		if (!exact) throw new TypeError("Unattested initial array");
		if (exact.kind === "value") return;
		if (
			session.authority.schema ||
			!session.authority.paths.some((entry) => entry.path.length > path.length && matches(entry.path, path, true))
		) {
			if (!initialValueAllowed(session, exact.path, value)) throw new TypeError("Invalid initial array");
		} else for (const [index, item] of value.entries()) validateInitialPaths(session, item, [...path, index]);
		return;
	}
	if (value && typeof value === "object") {
		for (const [name, child] of Object.entries(value)) validateInitialPaths(session, child, [...path, name]);
	} else if (!exact) throw new TypeError("Unattested initial value");
}

function initialValueAllowed(session: DemoSession, path: Reference["path"], value: JsonValue) {
	if (path.some((part) => typeof part === "number")) return false;
	if (session.authority.valueAllowed({ namespace: "data", path }, value)) return true;
	const node = session.authority.schema && schemaNode(session.authority.schema, path);
	return !!node && initialTypeAllowed(node, value);
}
