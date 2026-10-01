import { type JsonValue, copyJson } from "@formbar/expressions";
import type { SchemaDefaultV1 } from "./kalada-data-strategy.js";
const safeName = (value: unknown) =>
	typeof value === "string" &&
	value.length > 0 &&
	value.length <= 256 &&
	!["__proto__", "constructor", "prototype"].includes(value);

export function initializationProperty(owner: object, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(owner, name);
	if (!descriptor) {
		if (name in owner) throw new TypeError("Initialization requires own data properties.");
		return undefined;
	}
	if (!("value" in descriptor)) throw new TypeError("Initialization accessors are not supported.");
	return descriptor.value;
}

/** Only the data payload is copied. Context instance/revision and strategy functions remain opaque identities. */
export function initializationData(defaults: unknown, overrides?: unknown) {
	const data = copyJson({ defaults, ...(overrides === undefined ? {} : { overrides }) }) as Record<string, JsonValue>;
	if (!Array.isArray(data.defaults)) throw new TypeError("Invalid schema defaults.");
	for (const entry of data.defaults) {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError("Invalid schema default.");
		const item = entry as Record<string, JsonValue>;
		if (
			Object.keys(item).some((key) => key !== "path" && key !== "value") ||
			!Object.hasOwn(item, "value") ||
			!Array.isArray(item.path) ||
			item.path.length > 64 ||
			!item.path.every((part) => part === "*" || safeName(part))
		)
			throw new TypeError("Invalid schema default path/value.");
	}
	return {
		defaults: data.defaults as unknown as readonly SchemaDefaultV1[],
		...(Object.hasOwn(data, "overrides") ? { overrides: data.overrides as JsonValue } : {}),
	};
}

export function captureInitialization(options: object) {
	const input = initializationProperty(options, "initialization");
	if (input === undefined) return;
	if (
		!input ||
		typeof input !== "object" ||
		Array.isArray(input) ||
		![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
		Reflect.ownKeys(input).some((key) => key !== "defaults" && key !== "overrides")
	)
		throw new TypeError("Invalid schema initialization data.");
	return initializationData(initializationProperty(input, "defaults"), initializationProperty(input, "overrides"));
}
