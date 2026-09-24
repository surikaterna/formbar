/** Internal bounded JSON boundary for a future submit path; not a sandbox or hidden-data guarantee. */
const MAX_DEPTH = 32;
const MAX_NODES = 10_000;
const MAX_BYTES = 1_000_000;
const encoder = new TextEncoder();
const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

export interface CandidateInput {
	readonly data: Json;
	readonly uiState: Json;
}

export interface CandidateEgressContext extends CandidateInput {
	readonly phase: "egress";
}

export type CandidateEgress = (value: Json, context: CandidateEgressContext) => unknown;
export type CandidateProject = (input: CandidateInput) => unknown;

export type CandidateResult =
	| { readonly ok: true; readonly data: Json; readonly uiState: Json }
	| { readonly ok: false; readonly code: "unsafe_candidate" };

class Boundary {
	readonly seen = new Set<object>();
	readonly refs = new Set<object>();
	private nodes = 0;
	private bytes = 0;

	private charge(bytes: number): void {
		this.bytes += bytes;
		if (this.bytes > MAX_BYTES) throw new Error("budget");
	}

	copy(value: unknown, forbidden: ReadonlySet<object> = new Set(), depth = 0): Json {
		if (++this.nodes > MAX_NODES || depth > MAX_DEPTH) throw new Error("budget");
		if (value === null || typeof value === "boolean") {
			this.charge(5);
			return value;
		}
		if (typeof value === "number") {
			if (!Number.isFinite(value)) throw new Error("number");
			this.charge(24);
			return value;
		}
		if (typeof value === "string") {
			if (value.length > MAX_BYTES - this.bytes) throw new Error("budget");
			this.charge(encoder.encode(value).length + 2);
			return value;
		}
		if (typeof value !== "object") throw new Error("type");
		if (forbidden.has(value) || this.seen.has(value)) throw new Error("alias");
		const array = Array.isArray(value);
		const proto = Object.getPrototypeOf(value);
		if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw new Error("prototype");
		this.seen.add(value);
		this.refs.add(value);
		const keys = Reflect.ownKeys(value);
		if (keys.length > MAX_NODES - this.nodes || keys.some((key) => typeof key !== "string")) throw new Error("keys");
		if (array) return this.copyArray(value, keys.length, forbidden, depth);
		return this.copyObject(value, keys as string[], forbidden, depth);
	}

	private copyArray(value: object, keyCount: number, forbidden: ReadonlySet<object>, depth: number): Json[] {
		const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
		if (!Number.isSafeInteger(length) || length > MAX_NODES || keyCount !== length + 1) throw new Error("array");
		const result: Json[] = [];
		for (let i = 0; i < length; i++) {
			const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
			if (!descriptor?.enumerable || !("value" in descriptor)) throw new Error("array");
			result.push(this.copy(descriptor.value, forbidden, depth + 1));
		}
		return result;
	}

	private copyObject(value: object, keys: string[], forbidden: ReadonlySet<object>, depth: number): JsonObject {
		const result: JsonObject = Object.create(null);
		for (const key of keys) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (unsafeKeys.has(key) || !descriptor?.enumerable || !("value" in descriptor)) throw new Error("property");
			if (key.length > MAX_BYTES - this.bytes) throw new Error("budget");
			this.charge(encoder.encode(key).length + 3);
			result[key] = this.copy(descriptor.value, forbidden, depth + 1);
		}
		return result;
	}
}

function clone(value: unknown, forbidden?: ReadonlySet<object>): { value: Json; refs: Set<object> } {
	const boundary = new Boundary();
	return { value: boundary.copy(value, forbidden), refs: boundary.refs };
}

function freeze<T extends Json>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

function add(target: Set<object>, refs: ReadonlySet<object>): void {
	for (const ref of refs) target.add(ref);
}

function unchanged(value: unknown, baseline: Json): boolean {
	return JSON.stringify(clone(value).value) === JSON.stringify(baseline);
}

function retainedUnchanged(state: object, dataRef: unknown, uiRef: unknown, data: Json, ui: Json): boolean {
	const dataNow = Object.getOwnPropertyDescriptor(state, "data");
	const uiNow = Object.getOwnPropertyDescriptor(state, "uiState");
	return dataNow?.value === dataRef && uiNow?.value === uiRef && unchanged(dataRef, data) && unchanged(uiRef, ui);
}

function applyEgress(
	initial: Json,
	context: CandidateEgressContext,
	transforms: readonly CandidateEgress[],
	protectedRefs: ReadonlySet<object>,
	check: () => boolean,
): Json {
	let current = initial;
	for (const transform of transforms) {
		const inputValue = clone(current).value;
		const inputSnapshot = clone(inputValue).value;
		if (!check()) throw new Error("mutation");
		const output = transform(inputValue, context);
		if (!unchanged(inputValue, inputSnapshot) || !check()) throw new Error("mutation");
		const blocked = new Set(protectedRefs);
		if (output !== inputValue) add(blocked, clone(inputValue).refs);
		current = clone(output, blocked).value;
		if (!check()) throw new Error("mutation");
	}
	return current;
}

function makeContext(projection: Json, ui: Json, refs: Set<object>) {
	const context: CandidateEgressContext = Object.freeze({
		phase: "egress",
		data: freeze(clone(projection).value),
		uiState: freeze(clone(ui).value),
	});
	const snapshot = clone(context).value;
	add(refs, clone(context).refs);
	refs.add(context);
	return { context, snapshot };
}

/** Detectable aliases/mutations only. A transparent Proxy of retained data hides its target identity.
 * Arbitrary callback closures/proxy traps remain trusted; #210 decides that trust, not this helper.
 * This is not an enforceable hidden-payload confidentiality boundary. */
export function createSubmitCandidate(
	state: { readonly data: unknown; readonly uiState: unknown },
	project: CandidateProject,
	transforms: readonly CandidateEgress[] = [],
): CandidateResult {
	try {
		const dataDescriptor = Object.getOwnPropertyDescriptor(state, "data");
		const uiDescriptor = Object.getOwnPropertyDescriptor(state, "uiState");
		if (!dataDescriptor || !("value" in dataDescriptor) || !uiDescriptor || !("value" in uiDescriptor))
			throw new Error("state");
		const retained = new Boundary();
		const data = retained.copy(dataDescriptor.value);
		const ui = retained.copy(uiDescriptor.value);
		if (!retainedUnchanged(state, dataDescriptor.value, uiDescriptor.value, data, ui)) throw new Error("mutation");
		const input: CandidateInput = { data: freeze(data), uiState: freeze(ui) };
		Object.freeze(input);
		const protectedRefs = new Set(retained.refs);
		protectedRefs.add(state);
		add(protectedRefs, clone(input).refs);
		protectedRefs.add(input);
		const projected = project(input);
		if (
			!retainedUnchanged(state, dataDescriptor.value, uiDescriptor.value, data, ui) ||
			!unchanged(input, { data, uiState: ui })
		)
			throw new Error("mutation");
		const projection = clone(projected, protectedRefs);
		if (!retainedUnchanged(state, dataDescriptor.value, uiDescriptor.value, data, ui)) throw new Error("mutation");
		add(protectedRefs, projection.refs);
		const { context, snapshot } = makeContext(projection.value, ui, protectedRefs);
		const check = () =>
			unchanged(context, snapshot) &&
			unchanged(input, { data, uiState: ui }) &&
			unchanged(projected, projection.value) &&
			retainedUnchanged(state, dataDescriptor.value, uiDescriptor.value, data, ui);
		if (!check()) throw new Error("mutation");
		const current = applyEgress(projection.value, context, transforms, protectedRefs, check);
		const result: CandidateResult = { ok: true, data: freeze(clone(current).value), uiState: freeze(clone(ui).value) };
		if (!check()) throw new Error("mutation");
		return result;
	} catch {
		return { ok: false, code: "unsafe_candidate" };
	}
}
