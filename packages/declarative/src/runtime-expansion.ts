import type { FormState } from "@formbar/core";
import type { Scopes, StateRef } from "@formbar/expressions";
import type { ValidatedFormDefinition } from "./definition.js";
import type { FormNode } from "./nodes.js";
import type { RuntimeNodeInstance, RuntimeScopeInstance } from "./runtime-contracts.js";
import { readBinding, resolveBinding } from "./runtime-references.js";
import { inspectArrayLength } from "./runtime-repeaters.js";

export interface ConcreteNode {
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

export function expandDefinition(
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
	const length = inspectArrayLength(readBinding(state, binding));
	if (length === undefined) return;
	for (let index = 0; index < length; index++) {
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
