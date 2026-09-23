import { toDot } from "@formbar/core";
import type { FieldPolicyContribution, FormState, FormStateCapture, ValidationIssue } from "@formbar/core";
import type { JsonValue, NamespaceProvider, Scopes, StateRef } from "@formbar/expressions";
import { readOwn, resolveRef } from "@formbar/expressions";
import type { Binding } from "./bindings.js";
import type { RuntimeFormStatus, RuntimeNodeInstance } from "./runtime-contracts.js";

const emptyReferences = Object.freeze([]);

export interface ConcreteFieldReference {
	readonly instance: RuntimeNodeInstance;
	readonly binding: StateRef;
}

export interface DirectFieldLifecycle {
	readonly valid: boolean;
	readonly validating: boolean;
	readonly dirty: boolean;
	readonly touched: boolean;
}

interface ScopeIndexNode {
	readonly children: Map<string, ScopeIndexNode>;
	readonly fields: ConcreteFieldReference[];
}

export interface RuntimeReferenceIndex {
	issues(binding: StateRef): readonly ValidationIssue[];
	policies(binding: StateRef): readonly FieldPolicyContribution[];
	lifecycle(binding: StateRef): DirectFieldLifecycle;
	contextual(instance: RuntimeNodeInstance): Readonly<Record<string, DirectFieldLifecycle>>;
}

export function resolveBinding(binding: Binding, scopes: Scopes): StateRef {
	return resolveRef(binding, scopes);
}

export function readBinding(state: FormState<unknown, unknown>, binding: StateRef): JsonValue | undefined {
	const root = binding.namespace === "data" ? state.data : binding.namespace === "ui" ? state.uiState : undefined;
	if (root === undefined) return undefined;
	try {
		return readOwn(root, binding.segments) as JsonValue;
	} catch {
		return undefined;
	}
}

export function createRuntimeReferenceIndex(
	capture: FormStateCapture<unknown, unknown>,
	fields: readonly ConcreteFieldReference[],
): RuntimeReferenceIndex {
	const state = capture.state;
	const issues = groupByReference(state.issues, (issue) => issue.path);
	const policies = groupByReference(state.fieldPolicy, (policy) => policy.path);
	const scopes = createScopeIndex(fields);
	const lifecycle = new Map<string, DirectFieldLifecycle>();
	const contextual = new Map<string, Readonly<Record<string, DirectFieldLifecycle>>>();
	const readLifecycle = (binding: StateRef) => {
		const key = referenceKey(binding);
		const cached = lifecycle.get(key);
		if (cached) return cached;
		const value = fieldLifecycle(capture, binding, issues.get(key) ?? []);
		lifecycle.set(key, value);
		return value;
	};
	const index: RuntimeReferenceIndex = {
		issues: (binding) => issues.get(referenceKey(binding)) ?? emptyReferences,
		policies: (binding) => policies.get(referenceKey(binding)) ?? emptyReferences,
		lifecycle: readLifecycle,
		contextual: (instance) => cachedContextualSnapshot(instance, scopes, readLifecycle, contextual),
	};
	return Object.freeze(index);
}

function cachedContextualSnapshot(
	instance: RuntimeNodeInstance,
	scopes: ScopeIndexNode,
	readLifecycle: (binding: StateRef) => DirectFieldLifecycle,
	cache: Map<string, Readonly<Record<string, DirectFieldLifecycle>>>,
): Readonly<Record<string, DirectFieldLifecycle>> {
	const key = JSON.stringify(instance.scopes);
	const cached = cache.get(key);
	if (cached) return cached;
	const snapshot = contextualFieldSnapshot(instance, scopes, readLifecycle);
	cache.set(key, snapshot);
	return snapshot;
}

export function createSnapshotProviders(
	state: FormState<unknown, unknown>,
	formStatus: RuntimeFormStatus,
	fieldSnapshot: Readonly<Record<string, DirectFieldLifecycle>>,
): Readonly<Record<string, NamespaceProvider>> {
	const inert = () => () => {};
	return Object.freeze({
		data: { getSnapshot: () => state.data, subscribe: inert },
		ui: { getSnapshot: () => state.uiState, subscribe: inert },
		form: { getSnapshot: () => formStatus, subscribe: inert },
		field: { getSnapshot: () => fieldSnapshot, subscribe: inert },
	});
}

function contextualFieldSnapshot(
	current: RuntimeNodeInstance,
	root: ScopeIndexNode,
	readLifecycle: (binding: StateRef) => DirectFieldLifecycle,
): Readonly<Record<string, DirectFieldLifecycle>> {
	const selected = new Map<string, ConcreteFieldReference>();
	let scope: ScopeIndexNode | undefined = root;
	selectFields(scope, selected);
	for (const instance of current.scopes) {
		scope = scope?.children.get(scopeKey(instance));
		if (!scope) break;
		selectFields(scope, selected);
	}
	const snapshot: Record<string, DirectFieldLifecycle> = Object.create(null);
	for (const field of selected.values()) snapshot[field.instance.nodeId] = readLifecycle(field.binding);
	return Object.freeze(snapshot);
}

function createScopeIndex(fields: readonly ConcreteFieldReference[]): ScopeIndexNode {
	const root = scopeNode();
	for (const field of fields) {
		let current = root;
		for (const scope of field.instance.scopes) {
			const key = scopeKey(scope);
			let child = current.children.get(key);
			if (!child) {
				child = scopeNode();
				current.children.set(key, child);
			}
			current = child;
		}
		current.fields.push(field);
	}
	return root;
}

function scopeNode(): ScopeIndexNode {
	return { children: new Map(), fields: [] };
}

function scopeKey(scope: { readonly scope: string; readonly index: number }): string {
	return JSON.stringify([scope.scope, scope.index]);
}

function selectFields(scope: ScopeIndexNode, selected: Map<string, ConcreteFieldReference>): void {
	for (const field of scope.fields) selected.set(field.instance.nodeId, field);
}

function groupByReference<T>(
	values: readonly T[],
	reference: (value: T) => { readonly namespace: string; readonly segments: readonly (string | number)[] },
): ReadonlyMap<string, readonly T[]> {
	const grouped = new Map<string, T[]>();
	for (const value of values) {
		const key = referenceKey(reference(value));
		const bucket = grouped.get(key) ?? [];
		bucket.push(value);
		grouped.set(key, bucket);
	}
	return new Map([...grouped].map(([key, bucket]) => [key, Object.freeze(bucket)]));
}

function fieldLifecycle(
	capture: FormStateCapture<unknown, unknown>,
	binding: StateRef,
	issues: readonly ValidationIssue[],
): DirectFieldLifecycle {
	const metadataKey = fieldMetadataKey(binding);
	const metadata = metadataKey === undefined ? undefined : capture.state.fieldMeta[metadataKey];
	return Object.freeze({
		valid: !issues.some((issue) => issue.severity === "error"),
		validating: metadata?.isValidating ?? false,
		dirty: bindingDirty(capture, binding),
		touched: metadata?.touched ?? false,
	});
}

function referenceKey(reference: { readonly namespace: string; readonly segments: readonly (string | number)[] }) {
	return JSON.stringify([reference.namespace, reference.segments]);
}

function fieldMetadataKey(binding: StateRef): string | undefined {
	if (binding.namespace === "ui") {
		try {
			return toDot({ namespace: "ui", segments: binding.segments });
		} catch {
			return undefined;
		}
	}
	if (binding.namespace !== "data") return undefined;
	const segments = binding.segments.map(normalizeMetadataSegment);
	const dotSafe = segments.every((segment) => typeof segment === "number" || !segment.includes("."));
	if (segments[0] !== "$ui" && dotSafe) return segments.join(".");
	return `/${segments.map((segment) => String(segment).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

function bindingDirty(capture: FormStateCapture<unknown, unknown>, binding: StateRef): boolean {
	if (binding.namespace !== "data" && binding.namespace !== "ui") return false;
	return capture.isFieldDirty({ namespace: binding.namespace, segments: binding.segments });
}

const normalizeMetadataSegment = (segment: string | number): string | number =>
	typeof segment === "string" && /^(?:0|[1-9]\d*)$/.test(segment) ? Number(segment) : segment;
