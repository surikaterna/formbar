import type { FormApi, FormStateCapture, SubmitContext } from "@formbar/core";
import type { ScopedSyncHost, ScopedValidationInput } from "@formbar/core/internal/scoped-sync";
import type { AbsoluteBinding } from "./bindings.js";
import type { ValidatedFormDefinition } from "./definition.js";
import type { FieldIssueInput, FieldValidationTarget } from "./field-validation.js";
import type { FormNode } from "./nodes.js";
import { projectConcreteOwnership } from "./runtime-ownership.js";
import type { ConcreteOwner } from "./runtime-ownership.js";
import { certifyScopedOutput, sourceBound } from "./scoped-source-cert.js";

export interface DefinitionFieldValidator<TData, TUi> {
	readonly fieldId: string;
	readonly validate: (context: {
		readonly data: Readonly<TData>;
		readonly uiState: Readonly<TUi>;
		readonly field: FieldValidationTarget;
		readonly stage?: string;
		readonly context?: SubmitContext;
		readonly signal?: AbortSignal;
	}) => readonly FieldIssueInput[];
}

export function collect(node: FormNode, ids: Map<string, string>): void {
	if (ids.has(node.id)) throw new TypeError("Duplicate definition node ID");
	ids.set(node.id, node.type);
	if (node.type === "conditional") {
		for (const child of [...node.then, ...(node.else ?? [])]) collect(child, ids);
		return;
	}
	if (node.type === "tabs" || node.type === "accordion") {
		const entries = node.type === "tabs" ? node.tabs : node.items;
		for (const child of entries.flatMap((entry) => entry.children)) collect(child, ids);
		return;
	}
	if ("children" in node && node.children) for (const child of node.children) collect(child, ids);
}

function overlaps(a: AbsoluteBinding, b: AbsoluteBinding): boolean {
	if (a.namespace !== b.namespace) return false;
	const prefix = (x: readonly (string | number)[], y: readonly (string | number)[]) =>
		x.length <= y.length && x.every((part, i) => part === y[i]);
	return prefix(a.segments, b.segments) || prefix(b.segments, a.segments);
}

function syncValidator<TData, TUi>(entry: DefinitionFieldValidator<TData, TUi>, owner: ConcreteOwner) {
	return (input: ScopedValidationInput<unknown, unknown>) =>
		certifyScopedOutput(
			input.data,
			owner,
			entry.validate({
				data: input.data as Readonly<TData>,
				uiState: input.uiState as Readonly<TUi>,
				field: { instance: owner.instance, binding: { namespace: "data", segments: owner.binding.segments } },
				...(input.stage === undefined ? {} : { stage: input.stage }),
				...(input.context ? { context: input.context } : {}),
				...(input.signal ? { signal: input.signal } : {}),
			}),
		);
}

/** Prepare once against the validated definition; each invocation projects the current core capture. */
export function prepareScopedSyncHost<TData, TUi>(
	definition: ValidatedFormDefinition,
	validators: readonly DefinitionFieldValidator<TData, TUi>[],
): ScopedSyncHost<TData, TUi> {
	const ids = new Map<string, string>();
	collect(definition.root, ids);
	const registered = new Set<string>();
	const entries = validators.map((entry) => {
		if (ids.get(entry.fieldId) !== "field" || registered.has(entry.fieldId) || typeof entry.validate !== "function")
			throw new TypeError("Invalid or duplicate scoped field registration");
		registered.add(entry.fieldId);
		return Object.freeze({ fieldId: entry.fieldId, validate: entry.validate });
	});
	return Object.freeze({
		instances(form: FormApi<TData, TUi>, capture: FormStateCapture<TData, TUi>) {
			const ownership = projectConcreteOwnership({
				form: form as FormApi<unknown, unknown>,
				definition,
				capture: capture as Parameters<typeof projectConcreteOwnership>[0]["capture"],
			});
			if (!ownership.current() || ownership.diagnostics) throw new Error("Stale or ambiguous field projection");
			const fields = entries.flatMap((entry) =>
				(ownership.forField(entry.fieldId) ?? []).map((owner) => {
					if (
						(!owner.eligible && !sourceBound(capture.state.data, owner)) ||
						ownership.fields.some((other) => other !== owner && overlaps(other.binding, owner.binding))
					)
						throw new Error("Unowned or overlapping field binding");
					if (owner.binding.namespace !== "data") throw new Error("Invalid scoped field namespace");
					return Object.freeze({
						fieldId: entry.fieldId,
						instanceKey: owner.instance.instanceKey,
						binding: { namespace: "data" as const, segments: owner.binding.segments },
						validate: syncValidator(entry, owner),
					});
				}),
			);
			return { current: ownership.current, fields };
		},
	});
}
