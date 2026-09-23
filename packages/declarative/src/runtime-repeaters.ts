import type { FormState } from "@formbar/core";
import type { StateRef } from "@formbar/expressions";
import type { RepeaterNode } from "./nodes.js";
import type {
	ResolvedNodeState,
	ResolvedRepeaterState,
	RuntimeDiagnostic,
	RuntimeRepeaterBaseline,
} from "./runtime-contracts.js";
import { runtimeDiagnostic } from "./runtime-diagnostics.js";
import { readBinding } from "./runtime-references.js";

export function resolveRepeaterState(options: {
	readonly node: RepeaterNode;
	readonly nodeState: ResolvedNodeState;
	readonly binding?: StateRef;
	readonly state: FormState<unknown, unknown>;
	readonly baseline?: RuntimeRepeaterBaseline;
	readonly diagnostics: RuntimeDiagnostic[];
}): ResolvedRepeaterState {
	const limits = effectiveLimits(options.node, options.baseline);
	const value = options.binding ? readBinding(options.state, options.binding) : undefined;
	const ready = Array.isArray(value);
	if (!ready) options.diagnostics.push(runtimeDiagnostic("malformed-repeater", options.nodeState.instance, "binding"));
	if (limits.conflict)
		options.diagnostics.push(runtimeDiagnostic("conflicting-repeater-limits", options.nodeState.instance, "limits"));
	const length = ready ? value.length : 0;
	const items = Array.from({ length }, (_, index) =>
		Object.freeze({
			index,
			scopes: Object.freeze([
				...options.nodeState.instance.scopes,
				Object.freeze({ scope: options.node.scope, index }),
			]),
		}),
	);
	return Object.freeze({
		...options.nodeState,
		type: "repeater",
		...(options.binding ? { binding: absolute(options.binding) } : {}),
		status: ready ? "ready" : "malformed",
		minItems: limits.minItems,
		...(limits.maxItems === undefined ? {} : { maxItems: limits.maxItems }),
		limitsConflict: limits.conflict,
		length,
		label: options.node.label ?? options.baseline?.label ?? "Items",
		items: Object.freeze(items),
	});
}

function effectiveLimits(node: RepeaterNode, baseline?: RuntimeRepeaterBaseline) {
	const minItems = Math.max(node.minItems ?? 0, baseline?.minItems ?? 0);
	const candidates = [node.maxItems, baseline?.maxItems].filter((value): value is number => value !== undefined);
	const maxItems = candidates.length ? Math.min(...candidates) : undefined;
	return { minItems, maxItems, conflict: maxItems !== undefined && minItems > maxItems };
}

function absolute(binding: StateRef) {
	return Object.freeze({ namespace: binding.namespace, segments: Object.freeze([...binding.segments]) });
}

export function sameBinding(left: StateRef | undefined, right: StateRef | undefined): boolean {
	return Boolean(
		left &&
			right &&
			left.namespace === right.namespace &&
			left.segments.length === right.segments.length &&
			left.segments.every((segment, index) => segment === right.segments[index]),
	);
}
