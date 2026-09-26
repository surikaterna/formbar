import { structuredEqual } from "./equality.js";
import { ownIssues } from "./issue-ownership.js";
import type { FormState, ValidationIssue } from "./state.js";

const REJECTION = "ISSUE_ONLY_UNSUPPORTED_STATE";
const MAX_NODES = 100_000;
const MAX_DEPTH = 64;
export type Node = null | string | number | boolean | { array: boolean; children: [string, Node][] };

function reject(): never {
	throw new Error(REJECTION);
}

export function inspect(value: unknown, ancestors: Set<object>, count: { value: number }, depth: number): Node {
	if (depth > MAX_DEPTH || ++count.value > MAX_NODES) return reject();
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") return Number.isFinite(value) ? value : reject();
	if (typeof value !== "object" || ancestors.has(value)) return reject();
	const array = Array.isArray(value);
	if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		return reject();
	const keys = Reflect.ownKeys(value);
	const children: [string, Node][] = [];
	ancestors.add(value);
	for (const key of keys) {
		if (array && key === "length") continue;
		if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) return reject();
		if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) return reject();
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return reject();
		children.push([key, inspect(descriptor.value, ancestors, count, depth + 1)]);
	}
	if (array && children.length !== value.length) return reject();
	ancestors.delete(value);
	return { array, children };
}

/** Structural JSON comparison across the owned null-prototype / transaction-clone boundary. */
export function sameOwnedJson(left: unknown, right: unknown): boolean {
	try {
		return structuredEqual(inspect(left, new Set(), { value: 0 }, 0), inspect(right, new Set(), { value: 0 }, 0));
	} catch {
		return false;
	}
}

export function materialize(node: Node): unknown {
	if (node === null || typeof node !== "object") return node;
	const result: Record<string, unknown> | unknown[] = node.array ? [] : Object.create(null);
	for (const [key, child] of node.children)
		Object.defineProperty(result, key, {
			value: materialize(child),
			enumerable: true,
			writable: false,
			configurable: false,
		});
	return Object.freeze(result);
}

function checkAttempt(value: object): void {
	if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) reject();
	const keys = new Set(["submitId", "revision", "status", "issues", "renderableIssues"]);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string" || !keys.has(key)) reject();
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !("value" in descriptor)) reject();
	}
}

/** Validate before allocating an owned graph; never freeze a caller-held reference. */
export function ownNonIssueState<TData, TUi>(state: FormState<TData, TUi>): FormState<TData, TUi> {
	const allowed = new Set(["data", "uiState", "meta", "fieldMeta", "fieldPolicy", "issues", "attemptValidation"]);
	for (const key of Reflect.ownKeys(state)) {
		if (typeof key !== "string" || !allowed.has(key)) return reject();
		const descriptor = Object.getOwnPropertyDescriptor(state, key);
		if (!descriptor?.enumerable || !("value" in descriptor)) return reject();
	}
	const issues = ownIssues(state.issues);
	const attempt = state.attemptValidation;
	let attemptIssues: readonly ValidationIssue[] | undefined;
	let renderable: readonly ValidationIssue[] | undefined;
	if (attempt) {
		checkAttempt(attempt);
		attemptIssues = ownIssues(attempt.issues);
		renderable = ownIssues(attempt.renderableIssues);
	}
	const source = {
		data: state.data,
		uiState: state.uiState,
		meta: state.meta,
		fieldMeta: state.fieldMeta,
		fieldPolicy: state.fieldPolicy,
		...(attempt ? { attempt: { submitId: attempt.submitId, revision: attempt.revision, status: attempt.status } } : {}),
	};
	const plan = inspect(source, new Set(), { value: 0 }, 0);
	const owned = materialize(plan) as typeof source;
	const detachedAttempt = owned.attempt;
	return {
		...state,
		issues,
		data: owned.data,
		uiState: owned.uiState,
		meta: owned.meta,
		fieldMeta: owned.fieldMeta,
		fieldPolicy: owned.fieldPolicy,
		...(attempt && detachedAttempt && attemptIssues && renderable
			? {
					attemptValidation: {
						submitId: detachedAttempt.submitId,
						revision: detachedAttempt.revision,
						status: detachedAttempt.status,
						issues: attemptIssues,
						renderableIssues: renderable,
					},
				}
			: {}),
	};
}
