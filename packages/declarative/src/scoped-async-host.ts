import type { FormApi, FormStateCapture } from "@formbar/core";
import type { ScopedAsyncField, ScopedAsyncHost } from "@formbar/core/internal/scoped-sync";
import type { ScopedFieldIssueInput, ScopedValidationInput } from "@formbar/core/internal/scoped-sync";
import type { AbsoluteBinding } from "./bindings.js";
import type { ValidatedFormDefinition } from "./definition.js";
import type { RuntimeNodeInstance } from "./runtime-contracts.js";
import { projectConcreteOwnership } from "./runtime-ownership.js";
import { overlappingOwners } from "./scoped-async-overlaps.js";
import { collect } from "./scoped-sync-host.js";

export interface DefinitionAsyncFieldValidator<TData, TUi> {
	readonly id: string;
	readonly fieldId: string;
	readonly trigger?: "onChange" | "onBlur";
	readonly debounceMs?: number;
	readonly validate: (context: {
		readonly data: Readonly<TData>;
		readonly uiState: Readonly<TUi>;
		readonly field: { readonly instance: RuntimeNodeInstance; readonly binding: AbsoluteBinding };
		readonly signal: AbortSignal;
		readonly stage?: string;
		readonly context?: import("@formbar/core").SubmitContext;
	}) => Promise<readonly ScopedFieldIssueInput[]>;
}

function validateEntries<TData, TUi>(
	definition: ValidatedFormDefinition,
	validators: readonly DefinitionAsyncFieldValidator<TData, TUi>[],
) {
	const nodes = new Map<string, string>();
	collect(definition.root, nodes);
	const ids = new Set<string>();
	const entries = validators.map((entry) => {
		if (
			typeof entry.id !== "string" ||
			!entry.id.trim() ||
			ids.has(entry.id) ||
			nodes.get(entry.fieldId) !== "field" ||
			typeof entry.validate !== "function" ||
			(entry.trigger !== undefined && !["onChange", "onBlur"].includes(entry.trigger)) ||
			(entry.debounceMs !== undefined && (!Number.isSafeInteger(entry.debounceMs) || entry.debounceMs < 0))
		)
			throw new TypeError("Invalid scoped async field registration");
		ids.add(entry.id);
		return Object.freeze({ ...entry, trigger: entry.trigger ?? "onChange", debounceMs: entry.debounceMs ?? 300 });
	});
	return { ids, entries };
}

export function prepareScopedAsyncHost<TData, TUi>(
	definition: ValidatedFormDefinition,
	validators: readonly DefinitionAsyncFieldValidator<TData, TUi>[],
): ScopedAsyncHost<TData, TUi> {
	const { ids, entries } = validateEntries(definition, validators);
	return Object.freeze({
		ids,
		instances(
			form: FormApi<TData, TUi>,
			capture: FormStateCapture<TData, TUi>,
			currentCapture?: FormStateCapture<TData, TUi>,
		) {
			const ownership = projectConcreteOwnership({
				form: form as FormApi<unknown, unknown>,
				definition,
				capture: capture as Parameters<typeof projectConcreteOwnership>[0]["capture"],
				currentCapture: (currentCapture ?? capture) as Parameters<typeof projectConcreteOwnership>[0]["capture"],
			});
			if (!ownership.current() || ownership.diagnostics) throw new Error("Stale or ambiguous async field projection");
			const overlaps = overlappingOwners(ownership.fields);
			const fields: ScopedAsyncField[] = entries.flatMap((entry) =>
				(ownership.forField(entry.fieldId) ?? []).map((owner) => {
					if (!owner.eligible || overlaps.has(owner)) throw new Error("Unowned or overlapping async field binding");
					if (owner.binding.namespace !== "data") throw new Error("Invalid scoped async field namespace");
					return Object.freeze({
						id: entry.id,
						fieldId: entry.fieldId,
						instanceKey: owner.instance.instanceKey,
						binding: { namespace: "data" as const, segments: owner.binding.segments },
						trigger: entry.trigger,
						debounceMs: entry.debounceMs,
						validate: (input: ScopedValidationInput<unknown, unknown>) => {
							if (!input.signal) throw new Error("Missing scoped async signal");
							return entry.validate({
								data: input.data as Readonly<TData>,
								uiState: input.uiState as Readonly<TUi>,
								field: { instance: owner.instance, binding: owner.binding },
								signal: input.signal,
								...(input.stage === undefined ? {} : { stage: input.stage }),
								...(input.context ? { context: input.context } : {}),
							});
						},
					});
				}),
			);
			return { current: ownership.current, fields };
		},
	});
}
