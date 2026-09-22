import type { FormApi, FormState, ValidationIssue } from "@formbar/core";
import { toDot, toPointer } from "@formbar/core";
import type { JsonValue, NamespaceProvider, Scopes, StateRef } from "@formbar/expressions";
import { readOwn, resolveRef } from "@formbar/expressions";
import type { Binding } from "./bindings.js";
import type { RuntimeFormStatus, RuntimeNodeInstance } from "./runtime-contracts.js";

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

export function exactIssues(state: FormState<unknown, unknown>, binding: StateRef): readonly ValidationIssue[] {
	return Object.freeze(
		state.issues.filter(
			(issue) =>
				issue.path.namespace === binding.namespace &&
				issue.path.segments.length === binding.segments.length &&
				issue.path.segments.every((segment, index) => segment === binding.segments[index]),
		),
	);
}

export function directFieldLifecycle(
	form: FormApi<unknown, unknown>,
	state: FormState<unknown, unknown>,
	binding: StateRef,
): DirectFieldLifecycle {
	const issues = exactIssues(state, binding);
	const valid = !issues.some((issue) => issue.severity === "error");
	try {
		const field = form.fieldDynamic(runtimePath(binding));
		return Object.freeze({
			valid,
			validating: field.isValidating(),
			dirty: field.isDirty(),
			touched: field.isTouched(),
		});
	} catch {
		return Object.freeze({ valid, validating: false, dirty: false, touched: false });
	}
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

export function contextualFieldSnapshot(
	current: RuntimeNodeInstance,
	fields: readonly ConcreteFieldReference[],
	readLifecycle: (binding: StateRef) => DirectFieldLifecycle,
): Readonly<Record<string, DirectFieldLifecycle>> {
	const snapshot: Record<string, DirectFieldLifecycle> = Object.create(null);
	for (const field of fields) {
		if (!scopePrefix(field.instance, current)) continue;
		const existing = fields.find(
			(candidate) =>
				candidate.instance.nodeId === field.instance.nodeId &&
				scopePrefix(candidate.instance, current) &&
				candidate.instance.scopes.length > field.instance.scopes.length,
		);
		if (!existing) snapshot[field.instance.nodeId] = readLifecycle(field.binding);
	}
	return Object.freeze(snapshot);
}

function scopePrefix(candidate: RuntimeNodeInstance, current: RuntimeNodeInstance): boolean {
	if (candidate.scopes.length > current.scopes.length) return false;
	return candidate.scopes.every((scope, index) => {
		const active = current.scopes[index];
		return active?.scope === scope.scope && active.index === scope.index;
	});
}

function runtimePath(binding: StateRef): string {
	const path = { namespace: binding.namespace, segments: binding.segments } as Parameters<typeof toDot>[0];
	return binding.namespace === "data" ? toPointer(path) : toDot(path);
}
