type SeenPairs = WeakMap<object, WeakSet<object>>;

export function runtimeValueEqual(left: unknown, right: unknown): boolean {
	try {
		return equalValue(left, right, new WeakMap());
	} catch {
		return false;
	}
}

function equalValue(left: unknown, right: unknown, seen: SeenPairs): boolean {
	if (Object.is(left, right)) return true;
	if (!isObject(left) || !isObject(right)) return false;
	if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false;
	if (seenPair(left, right, seen)) return true;
	if (left instanceof Date && right instanceof Date) return Object.is(left.getTime(), right.getTime());
	if (left instanceof RegExp && right instanceof RegExp)
		return left.source === right.source && left.flags === right.flags && left.lastIndex === right.lastIndex;
	if (left instanceof Map && right instanceof Map) return equalMaps(left, right, seen);
	if (left instanceof Set && right instanceof Set) return equalSets(left, right, seen);
	if (left instanceof ArrayBuffer && right instanceof ArrayBuffer) return equalBytes(left, right);
	if (ArrayBuffer.isView(left) && ArrayBuffer.isView(right)) return equalViews(left, right);
	return propertyContainer(left) ? equalProperties(left, right, seen) : false;
}

function isObject(value: unknown): value is object {
	return typeof value === "object" && value !== null;
}

function propertyContainer(value: object): boolean {
	const prototype = Object.getPrototypeOf(value);
	return Array.isArray(value) || value instanceof Error || prototype === Object.prototype || prototype === null;
}

function seenPair(left: object, right: object, seen: SeenPairs): boolean {
	const rights = seen.get(left);
	if (rights?.has(right)) return true;
	if (rights) rights.add(right);
	else seen.set(left, new WeakSet([right]));
	return false;
}

function equalMaps(left: Map<unknown, unknown>, right: Map<unknown, unknown>, seen: SeenPairs): boolean {
	if (left.size !== right.size) return false;
	const leftEntries = [...left.entries()];
	const rightEntries = [...right.entries()];
	return leftEntries.every(([key, value], index) => {
		const candidate = rightEntries[index];
		return candidate !== undefined && equalValue(key, candidate[0], seen) && equalValue(value, candidate[1], seen);
	});
}

function equalSets(left: Set<unknown>, right: Set<unknown>, seen: SeenPairs): boolean {
	if (left.size !== right.size) return false;
	const leftValues = [...left.values()];
	const rightValues = [...right.values()];
	return leftValues.every((value, index) => equalValue(value, rightValues[index], seen));
}

function equalBytes(left: ArrayBuffer, right: ArrayBuffer): boolean {
	if (left.byteLength !== right.byteLength) return false;
	const leftBytes = new Uint8Array(left);
	const rightBytes = new Uint8Array(right);
	return leftBytes.every((value, index) => value === rightBytes[index]);
}

function equalViews(left: ArrayBufferView, right: ArrayBufferView): boolean {
	if (left.constructor !== right.constructor || left.byteLength !== right.byteLength) return false;
	const leftBytes = new Uint8Array(left.buffer, left.byteOffset, left.byteLength);
	const rightBytes = new Uint8Array(right.buffer, right.byteOffset, right.byteLength);
	return leftBytes.every((value, index) => value === rightBytes[index]);
}

function equalProperties(left: object, right: object, seen: SeenPairs): boolean {
	const leftKeys = Reflect.ownKeys(left);
	const rightKeys = Reflect.ownKeys(right);
	if (leftKeys.length !== rightKeys.length) return false;
	return leftKeys.every((key) => {
		if (!rightKeys.includes(key)) return false;
		const leftDescriptor = Object.getOwnPropertyDescriptor(left, key);
		const rightDescriptor = Object.getOwnPropertyDescriptor(right, key);
		if (!leftDescriptor || !rightDescriptor) return false;
		if (!("value" in leftDescriptor) || !("value" in rightDescriptor)) {
			return leftDescriptor.get === rightDescriptor.get && leftDescriptor.set === rightDescriptor.set;
		}
		return equalValue(leftDescriptor.value, rightDescriptor.value, seen);
	});
}
