import { synchronousValue } from "./async.js";
import type { JsonValue, ResolvedProps, Result, Setter, WriteResult } from "./contracts.js";
import { failure } from "./result.js";

export interface ForwardedProp<T extends JsonValue> {
	readonly value: T;
	readonly setValue?: (value: T) => WriteResult;
}

function synchronousGuard<T extends JsonValue>(value: JsonValue, accept: (value: JsonValue) => value is T): value is T {
	return synchronousValue(accept(value)) === true;
}

function write<T extends JsonValue>(value: T, accept: (value: JsonValue) => value is T, setter: Setter): WriteResult {
	try {
		return synchronousGuard(value, accept) ? synchronousValue(setter(value)) : failure("type");
	} catch {
		return failure("adapter");
	}
}

/** The host supplies the component's type guard; serialized expressions never select executable validators. */
export function forwardExpressionProp<T extends JsonValue>(
	props: ResolvedProps,
	name: string,
	accept: (value: JsonValue) => value is T,
): Result<ForwardedProp<T>> {
	try {
		if (props.diagnostics[name]) return { ok: false, diagnostics: props.diagnostics[name] };
		const value = props.values[name];
		if (value === undefined) return failure("missing");
		if (!synchronousGuard(value, accept)) return failure("type");
		const setter = props.setters[name];
		return {
			ok: true,
			value: { value, ...(setter ? { setValue: (next: T) => write(next, accept, setter) } : {}) },
		};
	} catch {
		return failure("adapter");
	}
}
