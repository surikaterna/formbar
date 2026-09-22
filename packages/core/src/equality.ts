interface Correspondence {
	readonly leftToRight: WeakMap<object, object>;
	readonly rightToLeft: WeakMap<object, object>;
}

/** Total structural equality for cloneable values, including reference topology. */
export function structuredEqual(left: unknown, right: unknown): boolean {
	try {
		return equalValue(left, right, { leftToRight: new WeakMap(), rightToLeft: new WeakMap() });
	} catch {
		return false;
	}
}

function equalValue(left: unknown, right: unknown, seen: Correspondence): boolean {
	if (Object.is(left, right)) {
		if (!isObject(left)) return true;
		return pairObjects(left, left, seen) !== false;
	}
	if (!isObject(left) || !isObject(right)) return false;
	if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false;
	const correspondence = pairObjects(left, right, seen);
	if (correspondence !== undefined) return correspondence;
	if (left instanceof Date && right instanceof Date) return Object.is(left.getTime(), right.getTime());
	if (left instanceof RegExp && right instanceof RegExp)
		return left.source === right.source && left.flags === right.flags && left.lastIndex === right.lastIndex;
	if (left instanceof Map && right instanceof Map) return equalMaps(left, right, seen);
	if (left instanceof Set && right instanceof Set) return equalSets(left, right, seen);
	if (left instanceof ArrayBuffer && right instanceof ArrayBuffer) return equalBytes(left, right);
	if (ArrayBuffer.isView(left) && ArrayBuffer.isView(right)) return equalViews(left, right, seen);
	// Cloneable containers are explicit; unsupported host/class objects compare conservatively unequal.
	return propertyContainer(left) ? equalProperties(left, right, seen) : false;
}

function isObject(value: unknown): value is object {
	return typeof value === "object" && value !== null;
}

function pairObjects(left: object, right: object, seen: Correspondence): boolean | undefined {
	const mappedRight = seen.leftToRight.get(left);
	const mappedLeft = seen.rightToLeft.get(right);
	if (mappedRight || mappedLeft) return mappedRight === right && mappedLeft === left;
	seen.leftToRight.set(left, right);
	seen.rightToLeft.set(right, left);
	return undefined;
}

function propertyContainer(value: object): boolean {
	const prototype = Object.getPrototypeOf(value);
	return Array.isArray(value) || value instanceof Error || prototype === Object.prototype || prototype === null;
}

function equalMaps(left: Map<unknown, unknown>, right: Map<unknown, unknown>, seen: Correspondence): boolean {
	if (left.size !== right.size) return false;
	const rightEntries = [...right.entries()];
	return [...left.entries()].every(([key, value], index) => {
		const candidate = rightEntries[index];
		return candidate !== undefined && equalValue(key, candidate[0], seen) && equalValue(value, candidate[1], seen);
	});
}

function equalSets(left: Set<unknown>, right: Set<unknown>, seen: Correspondence): boolean {
	if (left.size !== right.size) return false;
	const rightValues = [...right.values()];
	return [...left.values()].every((value, index) => equalValue(value, rightValues[index], seen));
}

function equalBytes(left: ArrayBuffer, right: ArrayBuffer): boolean {
	if (left.byteLength !== right.byteLength) return false;
	const rightBytes = new Uint8Array(right);
	return new Uint8Array(left).every((value, index) => value === rightBytes[index]);
}

function equalViews(left: ArrayBufferView, right: ArrayBufferView, seen: Correspondence): boolean {
	return (
		left.constructor === right.constructor &&
		left.byteOffset === right.byteOffset &&
		left.byteLength === right.byteLength &&
		equalValue(left.buffer, right.buffer, seen)
	);
}

function equalProperties(left: object, right: object, seen: Correspondence): boolean {
	const leftKeys = Reflect.ownKeys(left);
	const rightKeys = Reflect.ownKeys(right);
	if (leftKeys.length !== rightKeys.length) return false;
	return leftKeys.every((key) => equalProperty(left, right, key, rightKeys, seen));
}

function equalProperty(
	left: object,
	right: object,
	key: PropertyKey,
	rightKeys: readonly PropertyKey[],
	seen: Correspondence,
): boolean {
	if (!rightKeys.includes(key)) return false;
	const leftDescriptor = Object.getOwnPropertyDescriptor(left, key);
	const rightDescriptor = Object.getOwnPropertyDescriptor(right, key);
	if (!leftDescriptor || !rightDescriptor) return false;
	if (!("value" in leftDescriptor) || !("value" in rightDescriptor))
		return leftDescriptor.get === rightDescriptor.get && leftDescriptor.set === rightDescriptor.set;
	return equalValue(leftDescriptor.value, rightDescriptor.value, seen);
}
