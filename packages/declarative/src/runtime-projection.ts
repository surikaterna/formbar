import type { FormApi, FormState, FormStateCapture } from "@formbar/core";
import type { Expression, JsonValue, Scopes, StateRef } from "@formbar/expressions";
import type { ValidatedFormDefinition } from "./definition.js";
import { fieldContributions, mergeFieldRestrictions, resolveFieldState } from "./field-state.js";
import type { FormNode } from "./nodes.js";
import { resolveActionState } from "./runtime-action-state.js";
import { normalizeBaselines } from "./runtime-baselines.js";
import type {
	ResolvedFieldState,
	ResolvedNodeState,
	ResolvedOutputState,
	ResolvedRepeaterState,
	ResolvedValidationState,
	RuntimeDiagnostic,
	RuntimeExpressionProperty,
	RuntimeFieldBaseline,
	RuntimeFormStatus,
	RuntimeNodeInstance,
	RuntimeRepeaterBaseline,
	RuntimeResolvedNodeState,
	RuntimeScopeInstance,
	RuntimeSnapshot,
} from "./runtime-contracts.js";
import { runtimeDiagnostic, sortRuntimeDiagnostics } from "./runtime-diagnostics.js";
import { evaluateRuntimeExpression } from "./runtime-expressions.js";
import { readBinding, resolveBinding } from "./runtime-references.js";
import type { ConcreteFieldReference } from "./runtime-references.js";
import { resolveRepeaterState, sameBinding } from "./runtime-repeaters.js";
import { resolveFormStatus } from "./runtime-status.js";

interface ConcreteNode {
	readonly node: FormNode;
	readonly instance: RuntimeNodeInstance;
	readonly scopes: Scopes;
	readonly parentKey?: string;
	readonly requiredBranch?: "then" | "else";
	readonly binding?: StateRef;
	readonly target?: StateRef;
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
	readonly fieldBaselines: ReadonlyMap<string, RuntimeFieldBaseline>;
	readonly repeaterBaselines: ReadonlyMap<string, RuntimeRepeaterBaseline>;
	readonly diagnostics: RuntimeDiagnostic[];
}

export interface ProjectRuntimeOptions {
	readonly form: FormApi<unknown, unknown>;
	readonly definition: ValidatedFormDefinition;
	readonly baseline?: readonly RuntimeFieldBaseline[];
	readonly repeaterBaseline?: readonly RuntimeRepeaterBaseline[];
}

export function projectRuntime(options: ProjectRuntimeOptions): RuntimeSnapshot {
	const capture = options.form.captureState() as FormStateCapture<unknown, unknown>;
	const state = capture.state;
	const concrete = expandDefinition(options.definition, state);
	const diagnostics: RuntimeDiagnostic[] = [];
	const baselines = normalizeBaselines(
		options.definition,
		options.baseline ?? [],
		options.repeaterBaseline ?? [],
		diagnostics,
	);
	const formStatus = resolveFormStatus(capture);
	const fields = concreteFields(concrete);
	const context = {
		capture,
		state,
		formStatus,
		concrete,
		fields,
		fieldBaselines: baselines.fields,
		repeaterBaselines: baselines.repeaters,
		diagnostics,
	};
	const resolved = resolveNodes(context);
	return Object.freeze({
		data: state.data as JsonValue,
		uiState: state.uiState as JsonValue,
		form: formStatus,
		nodes: Object.freeze(resolved.nodes),
		fields: Object.freeze(resolved.fields),
		repeaters: Object.freeze(resolved.repeaters),
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
	const target = node.type === "action" && node.target ? safeBinding(node.target, frame.scopes) : undefined;
	output.push({
		node,
		instance,
		scopes: frame.scopes,
		...(frame.parentKey ? { parentKey: frame.parentKey } : {}),
		...(frame.requiredBranch ? { requiredBranch: frame.requiredBranch } : {}),
		...(binding ? { binding } : {}),
		...(target ? { target } : {}),
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
	readonly nodes: RuntimeResolvedNodeState[];
	readonly fields: ResolvedFieldState[];
	readonly repeaters: ResolvedRepeaterState[];
} {
	const nodes: RuntimeResolvedNodeState[] = [];
	const fields: ResolvedFieldState[] = [];
	const repeaters: ResolvedRepeaterState[] = [];
	const byKey = new Map<string, RuntimeResolvedNodeState>();
	for (const concrete of context.concrete) {
		const resolved = resolveNode(context, concrete, byKey, repeaters);
		nodes.push(resolved.node);
		byKey.set(concrete.instance.instanceKey, resolved.node);
		if (resolved.field) fields.push(resolved.field);
		if (resolved.node.type === "repeater") repeaters.push(resolved.node);
	}
	return { nodes, fields, repeaters };
}

function resolveNode(
	context: ProjectionContext,
	concrete: ConcreteNode,
	byKey: ReadonlyMap<string, RuntimeResolvedNodeState>,
	repeaters: readonly ResolvedRepeaterState[],
): { readonly node: RuntimeResolvedNodeState; readonly field?: ResolvedFieldState } {
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
	if (concrete.node.type === "output")
		return { node: resolveOutput(context, concrete, nodeState, concrete.node.value) };
	if (concrete.node.type === "action")
		return {
			node: resolveScopedAction(context, { ...concrete, node: concrete.node }, nodeState, repeaters),
		};
	if (concrete.node.type === "repeater")
		return { node: projectRepeater(context, { ...concrete, node: concrete.node }, nodeState) };
	if (concrete.node.type === "validation" && concrete.binding)
		return { node: projectValidation(nodeState, concrete.binding) };
	if (concrete.node.type !== "field" || !concrete.binding) return { node: nodeState as RuntimeResolvedNodeState };
	nodeState = mergeFieldRestrictions(nodeState, fieldContributions(context.state, concrete.binding));
	const conditionalRequired =
		evaluateBoolean(context, concrete, concrete.node.required, "required", false, true) ?? true;
	const baseline = context.fieldBaselines.get(concrete.node.id);
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

function projectRepeater(
	context: ProjectionContext,
	concrete: ConcreteNode & { readonly node: Extract<FormNode, { type: "repeater" }> },
	nodeState: ResolvedNodeState,
): ResolvedRepeaterState {
	const restricted = concrete.binding
		? mergeFieldRestrictions(nodeState, fieldContributions(context.state, concrete.binding))
		: nodeState;
	const baseline = context.repeaterBaselines.get(concrete.node.id);
	return resolveRepeaterState({
		node: concrete.node,
		nodeState: restricted,
		...(concrete.binding ? { binding: concrete.binding } : {}),
		state: context.state,
		...(baseline ? { baseline } : {}),
		diagnostics: context.diagnostics,
	});
}

function projectValidation(nodeState: ResolvedNodeState, binding: StateRef): ResolvedValidationState {
	return Object.freeze({
		...nodeState,
		type: "validation",
		binding: Object.freeze({ namespace: binding.namespace, segments: Object.freeze([...binding.segments]) }),
	});
}

function resolveScopedAction(
	context: ProjectionContext,
	concrete: ConcreteNode & { readonly node: Extract<FormNode, { type: "action" }> },
	nodeState: ResolvedNodeState,
	repeaters: readonly ResolvedRepeaterState[],
) {
	const repeater = concrete.node.action.startsWith("array.")
		? [...repeaters].reverse().find((candidate) => sameBinding(candidate.binding, concrete.target))
		: undefined;
	const effectiveState = repeater
		? Object.freeze({
				...nodeState,
				visible: nodeState.visible && repeater.visible,
				disabled: nodeState.disabled || repeater.disabled || repeater.status !== "ready" || repeater.limitsConflict,
				readOnly: nodeState.readOnly || repeater.readOnly,
			})
		: nodeState;
	return resolveActionState({
		node: concrete.node,
		nodeState: effectiveState,
		...(concrete.target ? { target: concrete.target } : {}),
		...(repeater
			? {
					arrayLimits: {
						minItems: repeater.minItems,
						...(repeater.maxItems === undefined ? {} : { maxItems: repeater.maxItems }),
						conflict: repeater.limitsConflict,
					},
				}
			: {}),
		frame: expressionFrame(context, concrete),
		diagnostics: context.diagnostics,
	});
}

function resolveOutput(
	context: ProjectionContext,
	concrete: ConcreteNode,
	nodeState: ResolvedNodeState,
	expression: Expression,
): ResolvedOutputState {
	if (!nodeState.visible) return Object.freeze({ ...nodeState, type: "output", output: { status: "hidden" as const } });
	const result = evaluateRuntimeExpression(expressionFrame(context, concrete), expression);
	if (result.ok)
		return Object.freeze({ ...nodeState, type: "output", output: { status: "ready" as const, value: result.value } });
	const code = result.diagnostics[0]?.code ?? "backend";
	context.diagnostics.push(runtimeDiagnostic("expression", concrete.instance, "value", code));
	return Object.freeze({ ...nodeState, type: "output", output: { status: "error" as const, code } });
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
	const result = evaluateRuntimeExpression(expressionFrame(context, concrete), expression);
	if (!result.ok)
		return expressionFailure(context, concrete, property, result.diagnostics[0]?.code, failureValue, condition);
	if (typeof result.value === "boolean") return result.value;
	context.diagnostics.push(runtimeDiagnostic("non-boolean", concrete.instance, property, "type"));
	return condition ? undefined : failureValue;
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

function expressionFrame(context: ProjectionContext, concrete: ConcreteNode) {
	return {
		capture: context.capture,
		state: context.state,
		formStatus: context.formStatus,
		fields: context.fields,
		instance: concrete.instance,
		scopes: concrete.scopes,
	};
}
