import type { FieldPolicyContribution, FormState, FormStateCapture } from "@formbar/core";
import type { JsonValue, StateRef } from "@formbar/expressions";
import type { AbsoluteBinding } from "./bindings.js";
import type { FieldNode } from "./nodes.js";
import type {
	ResolvedFieldState,
	ResolvedNodeState,
	RuntimeFieldBaseline,
	RuntimeNodeInstance,
} from "./runtime-contracts.js";
import { directFieldLifecycle, exactIssues, readBinding } from "./runtime-references.js";

export interface ResolveFieldStateOptions {
	readonly capture: FormStateCapture<unknown, unknown>;
	readonly state: FormState<unknown, unknown>;
	readonly node: FieldNode;
	readonly instance: RuntimeNodeInstance;
	readonly binding: StateRef;
	readonly nodeState: ResolvedNodeState;
	readonly baseline?: RuntimeFieldBaseline;
	readonly conditionalRequired: boolean;
}

export function resolveFieldState(options: ResolveFieldStateOptions): ResolvedFieldState {
	const contributions = matchingContributions(options.state.fieldPolicy, options.binding);
	const lifecycle = directFieldLifecycle(options.capture, options.binding);
	const issues = exactIssues(options.state, options.binding);
	const pluginLabel = lastPluginLabel(contributions);
	const value = readBinding(options.state, options.binding);
	return Object.freeze({
		...options.nodeState,
		type: "field",
		binding: options.binding as AbsoluteBinding,
		...(value === undefined ? {} : { value }),
		issues,
		...lifecycle,
		required:
			options.baseline?.required === true ||
			options.conditionalRequired ||
			contributions.some((item) => item.required === true),
		label: pluginLabel ?? options.node.label ?? options.baseline?.label ?? bindingPointer(options.binding),
	});
}

export function mergeFieldRestrictions(
	nodeState: ResolvedNodeState,
	contributions: readonly FieldPolicyContribution[],
): ResolvedNodeState {
	return Object.freeze({
		...nodeState,
		visible: nodeState.visible && contributions.every((item) => item.visible !== false),
		disabled: nodeState.disabled || contributions.some((item) => item.disabled === true),
		readOnly: nodeState.readOnly || contributions.some((item) => item.readOnly === true),
	});
}

export function fieldContributions(
	state: FormState<unknown, unknown>,
	binding: StateRef,
): readonly FieldPolicyContribution[] {
	return matchingContributions(state.fieldPolicy, binding);
}

function matchingContributions(
	contributions: readonly FieldPolicyContribution[],
	binding: StateRef,
): readonly FieldPolicyContribution[] {
	if (binding.namespace !== "data") return Object.freeze([]);
	return Object.freeze(
		contributions.filter(
			(item) =>
				item.path.segments.length === binding.segments.length &&
				item.path.segments.every((segment, index) => segment === binding.segments[index]),
		),
	);
}

function lastPluginLabel(contributions: readonly FieldPolicyContribution[]): string | undefined {
	let label: string | undefined;
	for (const contribution of contributions) {
		if (contribution.label !== undefined) label = contribution.label;
	}
	return label;
}

function bindingPointer(binding: StateRef): string {
	const encoded = binding.segments.map((segment) => String(segment).replace(/~/g, "~0").replace(/\//g, "~1"));
	return `${binding.namespace === "ui" ? "$ui" : ""}/${encoded.join("/")}`;
}
