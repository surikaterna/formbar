import { compileKaladaV1Program } from "@kalada/core";

// Fixture-local diagnostic label; no FormDefinition traversal or slot discovery happens here.
export const path = "fixture.condition";
export const ref = (segments, namespace = "data", scope = undefined) => ({
	namespace,
	segments,
	...(scope === undefined ? {} : { scope }),
});
export const expression = (reference) => ({ kind: "ref", ref: reference });
export const program = (node) => ({ format: "kalada-program", version: 1, profile: "kalada-v1", expression: node });
const safe = (name) =>
	typeof name === "string" &&
	name.length > 0 &&
	name.length <= 64 &&
	!["__proto__", "prototype", "constructor"].includes(name);
const fields = new Set(["show", "amount", "ready"]);
// Fixture-local enclosing repeater chain; real FormDefinition traversal belongs to #303.
export const lexical = [
	{ alias: "orders", namespace: "data", binding: ["orders"], parent: null },
	{ alias: "lines", namespace: "data", binding: ["lines"], parent: "orders" },
];

function resolvedScope(scope, namespace, chain) {
	if (!Array.isArray(chain) || chain.length === 0 || chain.length > 8) return false;
	const aliases = new Set();
	for (const [index, entry] of chain.entries()) {
		if (!entry || !safe(entry.alias) || aliases.has(entry.alias) || entry.namespace !== namespace) return false;
		if (!Array.isArray(entry.binding) || !entry.binding.length || entry.binding.length > 8) return false;
		if (!entry.binding.every(safe)) return false;
		if (entry.parent !== (index === 0 ? null : chain[index - 1].alias)) return false;
		aliases.add(entry.alias);
	}
	return aliases.has(scope);
}

function referenceCodec(chain) {
	return {
		validate(value) {
			if (!value || typeof value !== "object" || Array.isArray(value)) return false;
			if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
			const keys = Reflect.ownKeys(value);
			if (keys.some((key) => !["namespace", "segments", "scope"].includes(key))) return false;
			if (!Object.hasOwn(value, "namespace") || !Object.hasOwn(value, "segments")) return false;
			if (keys.some((key) => !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"))) return false;
			const { namespace, segments, scope } = value;
			if (!["data", "ui", "form", "field"].includes(namespace)) return false;
			if (!Array.isArray(segments) || segments.length < 1 || segments.length > 8) return false;
			if (segments.some((part) => !(safe(part) || (Number.isSafeInteger(part) && part >= 0)))) return false;
			if (scope !== undefined && (!safe(scope) || !resolvedScope(scope, namespace, chain))) return false;
			if (namespace === "form")
				return (
					scope === undefined &&
					segments.length === 1 &&
					["valid", "validating", "submitting", "dirty", "touched", "submitted"].includes(segments[0])
				);
			if (namespace === "field")
				return (
					scope === undefined &&
					segments.length === 2 &&
					fields.has(segments[0]) &&
					["valid", "validating", "dirty", "touched"].includes(segments[1])
				);
			// Scoped data segments are relative descendants, not alias-prefixed field names.
			return namespace === "ui" || (scope === undefined ? fields.has(segments[0]) : true);
		},
		canonicalize: (value) => ref([...value.segments], value.namespace, value.scope),
	};
}

const limits = { maxAstDepth: 16, maxAstNodes: 64, maxValueDepth: 16, maxValueNodes: 128, maxReferenceLength: 256 };
function safeJson(value, depth = 0, state = { nodes: 0, seen: new WeakSet() }) {
	if (++state.nodes > 128 || depth > 16) return false;
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (typeof value !== "object" || state.seen.has(value)) return false;
	if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
	state.seen.add(value);
	const keys = Reflect.ownKeys(value);
	if (Array.isArray(value) && (value.length !== keys.length - 1 || value.length > 128)) return false;
	for (const key of keys) {
		if (key === "length" && Array.isArray(value)) continue;
		if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key)) return false;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !Object.hasOwn(descriptor, "value") || !safeJson(descriptor.value, depth + 1, state))
			return false;
	}
	state.seen.delete(value);
	return true;
}

export function admit(input, { slot = path, chain = [], onReference = () => {}, limits: overrides = {} } = {}) {
	if (!safeJson(input)) return { ok: false, message: `${slot}: unsafe JSON or depth/node limit` };
	if (input && typeof input === "object" && ["literal", "ref", "op"].includes(input.kind))
		return { ok: false, message: `${slot}: RE-AUTHOR as Kalada` };
	const json = JSON.stringify(input);
	if (!json || Buffer.byteLength(json, "utf8") > 4096) return { ok: false, message: `${slot}: JSON size limit` };
	const codec = referenceCodec(chain);
	const compiled = compileKaladaV1Program(JSON.parse(json), {
		reference: {
			validate(value) {
				onReference(value);
				return codec.validate(value);
			},
			canonicalize(value) {
				onReference(value, "canonicalize");
				return codec.canonicalize(value);
			},
		},
		limits: { ...limits, ...overrides },
	});
	if (!compiled.ok)
		return {
			ok: false,
			message: `${slot}${compiled.diagnostic.path.length ? `.${compiled.diagnostic.path.join(".")}` : ""}: ${compiled.diagnostic.code}`,
		};
	return { ok: true, value: compiled.value };
}
