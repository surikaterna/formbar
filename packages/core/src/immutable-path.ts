import { assertSafeSegment } from "./safe-path.js";

const MAX_ARRAY_INDEX = 2 ** 32 - 2;
const ARRAY_INDEX = /^(?:0|[1-9][0-9]*)$/;

function canonicalArrayIndex(segment: string | number): number {
	if (typeof segment === "number") {
		if (!Number.isInteger(segment) || segment < 0 || segment > MAX_ARRAY_INDEX || Object.is(segment, -0)) {
			throw new TypeError("Invalid array index");
		}
		return segment;
	}
	if (!ARRAY_INDEX.test(segment)) throw new TypeError("Invalid array index");
	const index = Number(segment);
	if (!Number.isInteger(index) || index > MAX_ARRAY_INDEX) throw new TypeError("Invalid array index");
	return index;
}

function ownDataEntries(input: object): readonly (readonly [string, unknown])[] {
	if (!Array.isArray(input)) {
		const prototype = Object.getPrototypeOf(input);
		if (prototype !== Object.prototype && prototype !== null) throw new TypeError("Invalid state object");
	}
	const entries: [string, unknown][] = [];
	for (const key of Reflect.ownKeys(input)) {
		if (typeof key !== "string") throw new TypeError("Invalid state property");
		const descriptor = Object.getOwnPropertyDescriptor(input, key);
		if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
			if (Array.isArray(input) && key === "length" && descriptor && "value" in descriptor) continue;
			throw new TypeError("Invalid state property");
		}
		entries.push([key, descriptor.value]);
	}
	return entries;
}

function validateArray(input: readonly unknown[]): readonly (readonly [string, unknown])[] {
	if (Object.getPrototypeOf(input) !== Array.prototype) throw new TypeError("Invalid state array");
	const entries = ownDataEntries(input);
	if (entries.length !== input.length) throw new TypeError("Invalid state array");
	for (let index = 0; index < input.length; index++) {
		if (entries[index]?.[0] !== String(index)) throw new TypeError("Invalid state array");
	}
	return entries;
}

function descriptors(input: object): readonly (readonly [string, unknown])[] {
	return Array.isArray(input) ? validateArray(input) : ownDataEntries(input);
}

function dataValue(entries: readonly (readonly [string, unknown])[], key: string): unknown {
	return entries.find(([entry]) => entry === key)?.[1];
}

function validatePath(root: unknown, segments: readonly (string | number)[]): void {
	let current = root;
	for (let offset = 0; offset < segments.length; offset++) {
		if (current === null || typeof current !== "object") return;
		const entries = descriptors(current);
		const segment = segments[offset];
		assertSafeSegment(String(segment));
		if (Array.isArray(current)) {
			const index = canonicalArrayIndex(segment);
			if (index > current.length) throw new TypeError("Array writes may only replace or append");
			current = index === current.length ? undefined : entries[index]?.[1];
		} else current = dataValue(entries, String(segment));
	}
}

function normalizedObject(entries: readonly (readonly [string, unknown])[]): Record<string, unknown> {
	const output: Record<string, unknown> = {};
	for (const [key, value] of entries)
		Object.defineProperty(output, key, { value, enumerable: true, writable: true, configurable: true });
	return output;
}

function copyPath(root: unknown, segments: readonly (string | number)[], value: unknown): unknown {
	if (!segments.length) return value;
	const [segment, ...rest] = segments;
	const next = rest[0];
	const defaultChild = next !== undefined && (typeof next === "number" || ARRAY_INDEX.test(next)) ? [] : {};
	if (Array.isArray(root)) {
		const entries = validateArray(root);
		const index = canonicalArrayIndex(segment);
		const output = entries.map((entry) => entry[1]);
		output[index] = copyPath(entries[index]?.[1] ?? (rest.length ? defaultChild : undefined), rest, value);
		return output;
	}
	const entries = root && typeof root === "object" ? descriptors(root) : [];
	const key = String(segment);
	const output = normalizedObject(entries);
	output[key] = copyPath(dataValue(entries, key) ?? (rest.length ? defaultChild : undefined), rest, value);
	return output;
}

/** Descriptor-validates first, then immutably copies only the changed path. */
export function setImmutablePath(root: unknown, segments: readonly (string | number)[], value: unknown): unknown {
	validatePath(root, segments);
	return copyPath(root, segments, value);
}
