import type { DiagnosticCode } from "./contracts.js";
import { ExpressionError } from "./result.js";

const getDescriptor = Object.getOwnPropertyDescriptor;
const getPrototype = Object.getPrototypeOf;
const apply = Reflect.apply;
const functionToString = Function.prototype.toString;
const promiseThen = Promise.prototype.then;
const promiseSource = apply(functionToString, Promise, []);
const thenSource = apply(functionToString, promiseThen, []);
const speciesGetter = getDescriptor(Promise, Symbol.species)?.get;
const speciesSource = speciesGetter ? apply(functionToString, speciesGetter, []) : "";

function nativePromisePrototype(prototype: object): "safe" | "unsafe" | "none" {
	const then = getDescriptor(prototype, "then");
	if (!then || !("value" in then) || typeof then.value !== "function") return "none";
	if (apply(functionToString, then.value, []) !== thenSource) return "none";
	const constructorDescriptor = getDescriptor(prototype, "constructor");
	if (
		!constructorDescriptor ||
		!("value" in constructorDescriptor) ||
		typeof constructorDescriptor.value !== "function"
	)
		return "unsafe";
	const ownPrototype = getDescriptor(constructorDescriptor.value, "prototype");
	if (!ownPrototype || !("value" in ownPrototype) || ownPrototype.value !== prototype) return "unsafe";
	const species = getDescriptor(constructorDescriptor.value, Symbol.species);
	if (!species?.get || species.set !== undefined) return "unsafe";
	return apply(functionToString, constructorDescriptor.value, []) === promiseSource &&
		apply(functionToString, species.get, []) === speciesSource
		? "safe"
		: "unsafe";
}

function prototypeShape(value: object): "safe" | "unsafe" | "none" {
	let prototype = getPrototype(value);
	for (let depth = 0; prototype && depth < 4; depth++) {
		const shape = nativePromisePrototype(prototype);
		if (shape !== "none") return depth === 0 && shape === "safe" ? "safe" : "unsafe";
		prototype = getPrototype(prototype);
	}
	return "none";
}

function promiseShape(value: unknown): "safe" | "unsafe" | "none" {
	if (value === null || typeof value !== "object") return "none";
	try {
		const candidate = prototypeShape(value);
		if (candidate === "none") return "none";
		if (getDescriptor(value, "constructor") !== undefined || getDescriptor(value, "then") !== undefined)
			return "unsafe";
		if (getDescriptor(value, Symbol.species) !== undefined) return "unsafe";
		return candidate;
	} catch {
		return "none";
	}
}

/** Trusted callbacks support ordinary native Promises; suspicious species shapes are rejected without property access. */
export function isAsync(value: unknown): boolean {
	const shape = promiseShape(value);
	if (shape === "none") return false;
	if (shape === "safe") {
		try {
			void apply(promiseThen, value, [undefined, () => {}]);
		} catch {
			/* A failed brand check still means the Promise-like native shape is unsupported. */
		}
	}
	return true;
}

export function synchronousValue<T>(value: T, code: DiagnosticCode = "adapter"): T {
	if (isAsync(value)) throw new ExpressionError(code);
	return value;
}
