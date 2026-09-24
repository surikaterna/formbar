import type { DescriptorDocument, DescriptorOccurrence } from "@formbar/from-schema";

export interface InitialDataWarning {
	readonly channel: "initialization";
	readonly code: "unsafe-default";
	readonly message: string;
}

const forbidden = new Set(["__proto__", "constructor", "prototype"]);
const maxDepth = 32;
const maxEntries = 10_000;

function copyJson(
	value: unknown,
	seen = new Set<object>(),
	budget = { count: 0 },
	depth = 0,
	allowUndefined = false,
	allowTypeKey = false,
): unknown {
	if (++budget.count > maxEntries || depth > maxDepth) throw new TypeError("JSON value exceeds initialization limits");
	if (allowUndefined && value === undefined) return undefined;
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "object" || seen.has(value)) throw new TypeError("Unsafe JSON value");
	const array = Array.isArray(value);
	if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
		throw new TypeError("Non-plain JSON record");
	if (array && Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError("Non-plain JSON array");
	seen.add(value);
	const result: Record<string, unknown> | unknown[] = array ? [] : Object.create(null);
	const keys = Reflect.ownKeys(value);
	for (const key of keys) {
		if (typeof key !== "string" || forbidden.has(key) || (!allowUndefined && !allowTypeKey && key === "$type"))
			throw new TypeError("Unsafe JSON key");
		if (array && key === "length") continue;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !("value" in descriptor)) throw new TypeError("JSON accessor is not allowed");
		if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))
			throw new TypeError("Non-index array property");
		const copied = copyJson(descriptor.value, seen, budget, depth + 1, allowUndefined, allowTypeKey);
		Object.defineProperty(result, key, {
			value: copied,
			enumerable: descriptor.enumerable,
			writable: true,
			configurable: true,
		});
	}
	if (array && keys.length - 1 !== value.length) throw new TypeError("Sparse JSON array");
	seen.delete(value);
	return result;
}

function transparentChild(
	document: DescriptorDocument,
	occurrence: DescriptorOccurrence,
): DescriptorOccurrence | undefined {
	const node = document.nodes[occurrence.nodeId];
	const relation = node?.kind === "ref" ? "reference" : node?.kind === "wrapper" ? "wrapper" : undefined;
	if (!relation || occurrence.expansion !== "expanded") return undefined;
	return occurrence.children.map((id) => document.occurrences[id]).find((child) => child?.relation === relation);
}

function directProperties(document: DescriptorDocument): readonly DescriptorOccurrence[] {
	let current = document.occurrences[document.rootOccurrenceId];
	const visited = new Set<string>();
	while (current && current.expansion === "expanded" && !visited.has(current.id)) {
		visited.add(current.id);
		if (document.nodes[current.nodeId]?.kind === "object")
			return current.children.map((id) => document.occurrences[id]).filter((child) => child?.relation === "property");
		current = transparentChild(document, current);
	}
	return [];
}

function candidate(
	document: DescriptorDocument,
	property: DescriptorOccurrence,
): { present: boolean; value?: unknown } {
	let current: DescriptorOccurrence | undefined = property;
	const visited = new Set<string>();
	while (current && current.expansion === "expanded" && !visited.has(current.id)) {
		visited.add(current.id);
		const evidence = document.evidence[current.nodeId];
		if (evidence && Object.hasOwn(evidence, "default")) return { present: true, value: evidence.default };
		current = transparentChild(document, current);
	}
	return { present: false };
}

function ownData(value: unknown, key: string): unknown {
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("Not a schema record");
	if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
		throw new TypeError("Not a plain schema record");
	const entry = Object.getOwnPropertyDescriptor(value, key);
	if (!entry || !("value" in entry)) throw new TypeError("Missing or accessor schema property");
	return entry.value;
}

function localReference(root: unknown, reference: string): unknown {
	if (reference === "#") return root;
	if (!reference.startsWith("#/")) throw new TypeError("Not a local reference");
	let current = root;
	const segments = reference.slice(2).split("/");
	if (segments.length > maxDepth) throw new TypeError("Reference depth exceeded");
	for (const segment of segments) {
		const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
		if (forbidden.has(key)) throw new TypeError("Unsafe reference");
		current = ownData(current, key);
	}
	return current;
}

function referencedSchema(schema: unknown, root: unknown): unknown {
	const seen = new Set<object>();
	let current = schema;
	for (let depth = 0; depth < maxDepth; depth++) {
		if (typeof current !== "object" || current === null || seen.has(current))
			throw new TypeError("Cyclic or non-object schema");
		seen.add(current);
		const reference = Object.getOwnPropertyDescriptor(current, "$ref");
		if (!reference) return current;
		if (!("value" in reference) || typeof reference.value !== "string") throw new TypeError("Invalid reference");
		current = localReference(root, reference.value);
	}
	throw new TypeError("Reference depth exceeded");
}

function rawDefault(schema: unknown, property: string): unknown {
	const root = referencedSchema(schema, schema);
	const properties = ownData(root, "properties");
	const field = ownData(properties, property);
	const direct = Object.getOwnPropertyDescriptor(field, "default");
	if (direct) return ownData(field, "default");
	return ownData(referencedSchema(field, schema), "default");
}

export function schemaInitialData(
	document: DescriptorDocument,
	schema: unknown,
): {
	readonly defaults: Record<string, unknown>;
	readonly warnings: readonly InitialDataWarning[];
} {
	const defaults: Record<string, unknown> = Object.create(null);
	const warnings: InitialDataWarning[] = [];
	for (const property of directProperties(document)) {
		if (property.expansion !== "expanded" || typeof property.key !== "string") continue;
		const annotation = candidate(document, property);
		if (!annotation.present) continue;
		try {
			if (forbidden.has(property.key)) throw new TypeError("Unsafe property name");
			try {
				defaults[property.key] = copyJson(annotation.value);
			} catch {
				// Descriptor encoding may represent non-JSON values with $type; verify against the original annotation.
				if (document.source.provider !== "json-schema") throw new TypeError("Unsafe descriptor default");
				defaults[property.key] = copyJson(rawDefault(schema, property.key), new Set(), { count: 0 }, 0, false, true);
			}
		} catch {
			warnings.push({
				channel: "initialization",
				code: "unsafe-default",
				message: `Skipped unsafe default for ${property.key}`,
			});
		}
	}
	return { defaults, warnings: Object.freeze(warnings) };
}

export function mergeInitialData(defaults: Record<string, unknown>, caller: unknown): unknown {
	if (Object.keys(defaults).length === 0) return caller;
	if (caller == null) return defaults;
	try {
		if (
			typeof caller !== "object" ||
			Array.isArray(caller) ||
			![Object.prototype, null].includes(Object.getPrototypeOf(caller))
		)
			throw new TypeError("Initial data must be a plain record when schema defaults exist");
		// Validate the entire caller record, including non-enumerable and symbol keys, before reading any value.
		const safe = copyJson(caller, new Set(), { count: 0 }, 0, true) as Record<string, unknown>;
		return Object.assign(Object.create(null), defaults, safe);
	} catch {
		throw new TypeError("Unsafe initial data with schema defaults");
	}
}
