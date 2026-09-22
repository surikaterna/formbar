import type { FormApi, FormState, FormStateCapture } from "@formbar/core";
import { createExpressionService } from "@formbar/expressions";
import type { Expression, JsonValue, Scopes, StateRef } from "@formbar/expressions";
import type { ValidatedFormDefinition } from "./definition.js";
import { fieldContributions, mergeFieldRestrictions, resolveFieldState } from "./field-state.js";
import type { FormNode } from "./nodes.js";
import type {
	ResolvedFieldState,
	ResolvedNodeState,
	RuntimeDiagnostic,
	RuntimeExpressionProperty,
	RuntimeFieldBaseline,
	RuntimeFormStatus,
	RuntimeNodeInstance,
	RuntimeScopeInstance,
	RuntimeSnapshot,
} from "./runtime-contracts.js";
import { runtimeDiagnostic, sortRuntimeDiagnostics } from "./runtime-diagnostics.js";
import {
	contextualFieldSnapshot,
	createSnapshotProviders,
	directFieldLifecycle,
	readBinding,
	resolveBinding,
} from "./runtime-references.js";
import type { ConcreteFieldReference } from "./runtime-references.js";

interface ConcreteNode {
	readonly node: FormNode;
	readonly instance: RuntimeNodeInstance;
	readonly scopes: Scopes;
	readonly parentKey?: string;
	readonly requiredBranch?: "then" | "else";
	readonly binding?: StateRef;
}

interface ExpandFrame {
	readonly scopes: Scopes;
	readonly scopeInstances: readonly RuntimeScopeInstance[];
	readonly parentKey?: string;
	readonly requiredBranch?: "then" | "else";
}

interface ProjectionContext {
	readonly capture: FormStateCapture<unknown, unknown>;
	readonly state: FormState<unknown, unknown>;
	readonly formStatus: RuntimeFormStatus;
	readonly concrete: readonly ConcreteNode[];
	readonly fields: readonly ConcreteFieldReference[];
	readonly baselines: ReadonlyMap<string, RuntimeFieldBaseline>;
	readonly diagnostics: RuntimeDiagnostic[];
}

export interface ProjectRuntimeOptions {
	readonly form: FormApi<unknown, unknown>;
	readonly definition: ValidatedFormDefinition;
	readonly baseline?: readonly RuntimeFieldBaseline[];
}

export function projectRuntime(options: ProjectRuntimeOptions): RuntimeSnapshot {
	const capture = options.form.captureState() as FormStateCapture<unknown, unknown>;
	const state = capture.state;
	const concrete = expandDefinition(options.definition, state);
	const diagnostics: RuntimeDiagnostic[] = [];
	const baselines = normalizeBaselines(options.definition, options.baseline ?? [], diagnostics);
	const formStatus = resolveFormStatus(capture);
	const fields = concreteFields(concrete);
	const context = { capture, state, formStatus, concrete, fields, baselines, diagnostics };
	const resolved = resolveNodes(context);
	return Object.freeze({
		data: state.data as JsonValue,
		uiState: state.uiState as JsonValue,
		form: formStatus,
		nodes: Object.freeze(resolved.nodes),
		fields: Object.freeze(resolved.fields),
		diagnostics: sortRuntimeDiagnostics(diagnostics),
	});
}

function expandDefinition(
	definition: ValidatedFormDefinition,
	state: FormState<unknown, unknown>,
): readonly ConcreteNode[] {
	const output: ConcreteNode[] = [];
	expandNode(definition.root, { scopes: Object.freeze({}), scopeInstances: Object.freeze([]) }, state, output);
	return Object.freeze(output);
}

function expandNode(
	node: FormNode,
	frame: ExpandFrame,
	state: FormState<unknown, unknown>,
	output: ConcreteNode[],
): void {
	const instance = createInstance(node.id, frame.scopeInstances);
	const binding = "binding" in node ? safeBinding(node.binding, frame.scopes) : undefined;
	output.push({
		node,
		instance,
		scopes: frame.scopes,
		...(frame.parentKey ? { parentKey: frame.parentKey } : {}),
		...(frame.requiredBranch ? { requiredBranch: frame.requiredBranch } : {}),
		...(binding ? { binding } : {}),
	});
	const childFrame = { scopes: frame.scopes, scopeInstances: frame.scopeInstances, parentKey: instance.instanceKey };
	if (node.type === "repeater") expandRepeater(node, binding, childFrame, state, output);
	else if (node.type === "conditional") expandConditional(node, childFrame, state, output);
	else for (const child of nodeChildren(node)) expandNode(child, childFrame, state, output);
}

function expandRepeater(
	node: Extract<FormNode, { type: "repeater" }>,
	binding: StateRef | undefined,
	frame: ExpandFrame,
	state: FormState<unknown, unknown>,
	output: ConcreteNode[],
): void {
	if (!binding) return;
	const items = readBinding(state, binding);
	if (!Array.isArray(items)) return;
	for (let index = 0; index < items.length; index++) {
		const scope = Object.freeze({
			namespace: binding.namespace,
			segments: Object.freeze([...binding.segments, index]),
		});
		const scopes = Object.freeze({ ...frame.scopes, [node.scope]: scope });
		const scopeInstances = Object.freeze([...frame.scopeInstances, Object.freeze({ scope: node.scope, index })]);
		for (const child of node.children) expandNode(child, { ...frame, scopes, scopeInstances }, state, output);
	}
}

function expandConditional(
	node: Extract<FormNode, { type: "conditional" }>,
	frame: ExpandFrame,
	state: FormState<unknown, unknown>,
	output: ConcreteNode[],
): void {
	for (const child of node.then) expandNode(child, { ...frame, requiredBranch: "then" }, state, output);
	for (const child of node.else ?? []) expandNode(child, { ...frame, requiredBranch: "else" }, state, output);
}

function nodeChildren(node: FormNode): readonly FormNode[] {
	if (node.type === "group" || node.type === "section") return node.children;
	if (node.type === "tabs") return node.tabs.flatMap((tab) => tab.children);
	if (node.type === "accordion") return node.items.flatMap((item) => item.children);
	if (node.type === "custom") return node.children ?? [];
	return [];
}

function createInstance(nodeId: string, scopes: readonly RuntimeScopeInstance[]): RuntimeNodeInstance {
	const frozenScopes = Object.freeze([...scopes]);
	return Object.freeze({ nodeId, scopes: frozenScopes, instanceKey: JSON.stringify([nodeId, frozenScopes]) });
}

function safeBinding(binding: Parameters<typeof resolveBinding>[0], scopes: Scopes): StateRef | undefined {
	try {
		return resolveBinding(binding, scopes);
	} catch {
		return undefined;
	}
}

function concreteFields(concrete: readonly ConcreteNode[]): readonly ConcreteFieldReference[] {
	return Object.freeze(
		concrete
			.filter((item) => item.node.type === "field" && item.binding !== undefined)
			.map((item) => Object.freeze({ instance: item.instance, binding: item.binding as StateRef })),
	);
}

function resolveNodes(context: ProjectionContext): {
	readonly nodes: ResolvedNodeState[];
	readonly fields: ResolvedFieldState[];
} {
	const nodes: ResolvedNodeState[] = [];
	const fields: ResolvedFieldState[] = [];
	const byKey = new Map<string, ResolvedNodeState>();
	for (const concrete of context.concrete) {
		const resolved = resolveNode(context, concrete, byKey);
		nodes.push(resolved.node);
		byKey.set(concrete.instance.instanceKey, resolved.node);
		if (resolved.field) fields.push(resolved.field);
	}
	return { nodes, fields };
}

function resolveNode(
	context: ProjectionContext,
	concrete: ConcreteNode,
	byKey: ReadonlyMap<string, ResolvedNodeState>,
): { readonly node: ResolvedNodeState; readonly field?: ResolvedFieldState } {
	const parent = concrete.parentKey ? byKey.get(concrete.parentKey) : undefined;
	const own = resolveOwnState(context, concrete);
	const branchVisible = !concrete.requiredBranch || parent?.branch === concrete.requiredBranch;
	let nodeState: ResolvedNodeState = Object.freeze({
		instance: concrete.instance,
		type: concrete.node.type,
		visible: (parent?.visible ?? true) && branchVisible && own.visible,
		disabled: (parent?.disabled ?? false) || own.disabled,
		readOnly: (parent?.readOnly ?? false) || own.readOnly,
		...(own.branch ? { branch: own.branch } : {}),
	});
	if (concrete.node.type !== "field" || !concrete.binding) return { node: nodeState };
	nodeState = mergeFieldRestrictions(nodeState, fieldContributions(context.state, concrete.binding));
	const conditionalRequired =
		evaluateBoolean(context, concrete, concrete.node.required, "required", false, true) ?? true;
	const baseline = context.baselines.get(concrete.node.id);
	const field = resolveFieldState({
		capture: context.capture,
		state: context.state,
		node: concrete.node,
		instance: concrete.instance,
		binding: concrete.binding,
		nodeState,
		...(baseline ? { baseline } : {}),
		conditionalRequired,
	});
	return { node: field, field };
}

function resolveOwnState(context: ProjectionContext, concrete: ConcreteNode) {
	const visible = evaluateBoolean(context, concrete, concrete.node.visible, "visible", true, false) ?? false;
	const disabled = evaluateBoolean(context, concrete, concrete.node.disabled, "disabled", false, true) ?? true;
	const readOnly = evaluateBoolean(context, concrete, concrete.node.readOnly, "readOnly", false, true) ?? true;
	if (concrete.node.type !== "conditional") return { visible, disabled, readOnly };
	const condition = evaluateCondition(context, concrete, concrete.node.condition);
	return {
		visible,
		disabled,
		readOnly,
		branch: condition === undefined ? "none" : condition ? "then" : "else",
	} as const;
}

function evaluateCondition(
	context: ProjectionContext,
	concrete: ConcreteNode,
	expression: Expression,
): boolean | undefined {
	return evaluateBoolean(context, concrete, expression, "condition", false, false, true);
}

function evaluateBoolean(
	context: ProjectionContext,
	concrete: ConcreteNode,
	expression: Expression | undefined,
	property: RuntimeExpressionProperty,
	defaultValue: boolean,
	failureValue: boolean,
	condition = false,
): boolean | undefined {
	if (!expression) return defaultValue;
	const service = createExpressionService({
		scopes: concrete.scopes,
		namespaces: expressionProviders(context, concrete),
		authorize: (reference) => ["data", "ui", "form", "field"].includes(reference.namespace),
	});
	try {
		const compiled = service.compile(expression);
		if (!compiled.ok)
			return expressionFailure(context, concrete, property, compiled.diagnostics[0]?.code, failureValue, condition);
		const result = service.evaluate(compiled.value);
		if (!result.ok)
			return expressionFailure(context, concrete, property, result.diagnostics[0]?.code, failureValue, condition);
		if (typeof result.value === "boolean") return result.value;
		context.diagnostics.push(runtimeDiagnostic("non-boolean", concrete.instance, property, "type"));
		return condition ? undefined : failureValue;
	} finally {
		service.dispose();
	}
}

function expressionFailure(
	context: ProjectionContext,
	concrete: ConcreteNode,
	property: RuntimeExpressionProperty,
	code: Parameters<typeof runtimeDiagnostic>[3],
	fallback: boolean,
	condition: boolean,
): boolean | undefined {
	context.diagnostics.push(runtimeDiagnostic("expression", concrete.instance, property, code));
	return condition ? undefined : fallback;
}

function expressionProviders(context: ProjectionContext, concrete: ConcreteNode) {
	const fieldSnapshot = contextualFieldSnapshot(concrete.instance, context.fields, (binding) =>
		directFieldLifecycle(context.capture, binding),
	);
	return createSnapshotProviders(context.state, context.formStatus, fieldSnapshot);
}

function resolveFormStatus(capture: FormStateCapture<unknown, unknown>): RuntimeFormStatus {
	const state = capture.state;
	return Object.freeze({
		valid: !state.issues.some((issue) => issue.severity === "error"),
		validating: state.meta.validation.validating === true,
		submitting: state.meta.submission?.status === "running",
		dirty: capture.isFormDirty(),
		touched: Object.values(state.fieldMeta).some((entry) => entry.touched),
		submitted: state.meta.submitted === true,
	});
}

function normalizeBaselines(
	definition: ValidatedFormDefinition,
	input: readonly RuntimeFieldBaseline[],
	diagnostics: RuntimeDiagnostic[],
): ReadonlyMap<string, RuntimeFieldBaseline> {
	const fieldIds = new Set(fieldNodes(definition.root).map((node) => node.id));
	const grouped = new Map<string, RuntimeFieldBaseline[]>();
	input.forEach((entry, index) => {
		if (!validBaseline(entry) || !fieldIds.has(entry.nodeId)) {
			diagnostics.push(runtimeDiagnostic("invalid-baseline", baselineInstance(entry, index), "baseline"));
			return;
		}
		grouped.set(entry.nodeId, [...(grouped.get(entry.nodeId) ?? []), entry]);
	});
	const normalized = new Map<string, RuntimeFieldBaseline>();
	for (const [nodeId, entries] of grouped) {
		if (entries.length > 1)
			diagnostics.push(runtimeDiagnostic("duplicate-baseline", baselineInstance(entries[0], 0), "baseline"));
		else normalized.set(nodeId, Object.freeze({ ...entries[0] }));
	}
	return normalized;
}

function validBaseline(value: RuntimeFieldBaseline): boolean {
	if (!value || typeof value !== "object" || typeof value.nodeId !== "string") return false;
	if (value.required !== undefined && typeof value.required !== "boolean") return false;
	if (value.label !== undefined && typeof value.label !== "string") return false;
	return Object.keys(value).every((key) => ["nodeId", "required", "label"].includes(key));
}

function baselineInstance(value: RuntimeFieldBaseline, index: number): RuntimeNodeInstance {
	const nodeId = value && typeof value.nodeId === "string" ? value.nodeId : "";
	return Object.freeze({ nodeId, instanceKey: `baseline:${nodeId}:${index}`, scopes: Object.freeze([]) });
}

function fieldNodes(root: FormNode): readonly Extract<FormNode, { type: "field" }>[] {
	const fields: Extract<FormNode, { type: "field" }>[] = [];
	const visit = (node: FormNode): void => {
		if (node.type === "field") fields.push(node);
		for (const child of nodeChildren(node)) visit(child);
		if (node.type === "repeater") for (const child of node.children) visit(child);
		if (node.type === "conditional") for (const child of [...node.then, ...(node.else ?? [])]) visit(child);
	};
	visit(root);
	return fields;
}
