import { ExpressionError } from "./result.js";

export type OwnDataEntry = readonly [key: string, value: unknown];
const unsafeKeys = new Set(["__proto__", "constructor", "prototype"]);

function arrayLength(input: readonly unknown[]): number {
	const descriptor = Object.getOwnPropertyDescriptor(input, "length");
	if (!descriptor || !("value" in descriptor) || !Number.isInteger(descriptor.value)) {
		throw new ExpressionError("denied");
	}
	const length = descriptor.value;
	if (length < 0 || length > 2 ** 32 - 1) throw new ExpressionError("denied");
	return length;
}

function validatePrototype(input: object): void {
	const prototype = Object.getPrototypeOf(input);
	if (Array.isArray(input)) {
		if (prototype !== Array.prototype) throw new ExpressionError("denied");
		return;
	}
	if (prototype !== Object.prototype && prototype !== null) throw new ExpressionError("denied");
}

/** Captures every supported own data descriptor without ordinary property reads. */
export function inspectDataContainer(input: object): readonly OwnDataEntry[] {
	validatePrototype(input);
	const array = Array.isArray(input);
	const length = array ? arrayLength(input as readonly unknown[]) : undefined;
	const entries: OwnDataEntry[] = [];
	for (const key of Reflect.ownKeys(input)) {
		if (array && key === "length") continue;
		if (typeof key !== "string" || unsafeKeys.has(key)) throw new ExpressionError("denied");
		const descriptor = Object.getOwnPropertyDescriptor(input, key);
		if (!descriptor?.enumerable || !("value" in descriptor)) throw new ExpressionError("denied");
		entries.push([key, descriptor.value]);
	}
	if (array) validateArrayEntries(entries, length as number);
	return entries;
}

function validateArrayEntries(entries: readonly OwnDataEntry[], length: number): void {
	if (entries.length !== length) throw new ExpressionError("denied");
	for (let index = 0; index < length; index++) {
		if (entries[index]?.[0] !== String(index)) throw new ExpressionError("denied");
	}
}
