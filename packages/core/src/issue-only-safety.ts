/** Reject object types whose internals remain mutable even after Object.freeze. */
export function assertShareable(value: unknown, seen = new WeakSet<object>()): void {
	if (typeof value === "function") throw new Error("Issue-only publication cannot share callable state");
	if (value === null || typeof value !== "object" || seen.has(value)) return;
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype) {
		throw new Error("Issue-only publication requires plain immutable-shareable state");
	}
	seen.add(value);
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !("value" in descriptor)) {
			throw new Error("Issue-only publication cannot share accessor state");
		}
		assertShareable(descriptor.value, seen);
	}
}
