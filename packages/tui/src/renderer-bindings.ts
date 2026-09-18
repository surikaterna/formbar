import type { FormbarOption } from "@formbar/from-schema";
import type { MutableEditState } from "./edit-state.js";
import type { TuiFieldCodec } from "./field-adapters.js";
import type { DefaultBindingContribution, InteractionTarget, ScopedInteractionCapability } from "./interaction.js";
import type { FormNavigationSession } from "./navigation-session.js";

const INPUTS = [
	["enter", "Enter"],
	["escape", "Esc"],
	["tab", "Tab"],
	["space", "Space"],
	["arrow-left", "←"],
	["arrow-up", "↑"],
	["arrow-right", "→"],
	["arrow-down", "↓"],
	["backspace", "Backspace"],
	["delete-forward", "Delete"],
	["form-submit", "Ctrl+S"],
] as const;

export function bindings(
	session: FormNavigationSession,
	state: MutableEditState,
	codecs: ReadonlyMap<string, TuiFieldCodec>,
	disabled: ReadonlySet<string>,
): readonly DefaultBindingContribution[] {
	const target = session.getSelectedTarget();
	if (!target) return [];
	if (target.kind === "group") return withSubmit(groupBindings(session, target), target);
	if (state.mode === "navigation")
		return withSubmit(navigationBindings(target, codecs.get(target.path), disabled.has(target.path)), target);
	const result = editBindings(target, state.mode);
	if (state.mode === "select") {
		result.push(binding("arrow-down", "select-next", target, "Next option"));
		result.push(binding("arrow-up", "select-previous", target, "Previous option"));
		result.push(binding("space", "activate", target, "Accept option"));
	}
	return withSubmit(result, target);
}

function withSubmit(bindings: DefaultBindingContribution[], target: InteractionTarget): DefaultBindingContribution[] {
	bindings.push(binding("form-submit", "submit", target, "Submit form"));
	return bindings;
}

function groupBindings(session: FormNavigationSession, target: InteractionTarget): DefaultBindingContribution[] {
	const group = session.getSnapshot().groups[session.getSnapshot().groupSelection];
	const result = [binding("enter", "activate", target, `Enter ${group?.label ?? "group"}`)];
	for (const input of ["tab", "arrow-right", "arrow-down"]) result.push(binding(input, "next", target, "Next group"));
	for (const input of ["arrow-left", "arrow-up"]) result.push(binding(input, "previous", target, "Previous group"));
	return result;
}

function editBindings(target: InteractionTarget, mode: MutableEditState["mode"]): DefaultBindingContribution[] {
	return [
		binding("enter", "activate", target, mode === "select" ? "Accept option" : "Commit edit"),
		binding("tab", "next", target, mode === "select" ? "Accept and next" : "Commit and next"),
		binding("escape", "back", target, mode === "select" ? "Dismiss options" : "Cancel edit"),
		binding("backspace", "backspace", target, "Delete before"),
		binding("delete-forward", "delete", target, "Delete at"),
		binding("arrow-left", "left", target, "Caret left"),
		binding("arrow-right", "right", target, "Caret right"),
	];
}

function navigationBindings(
	target: Extract<InteractionTarget, { kind: "field" }>,
	codec: TuiFieldCodec | undefined,
	disabled: boolean,
): DefaultBindingContribution[] {
	const result: DefaultBindingContribution[] = [];
	for (const input of ["tab", "arrow-right", "arrow-down"]) result.push(binding(input, "next", target, "Next field"));
	for (const input of ["arrow-left", "arrow-up"]) result.push(binding(input, "previous", target, "Previous field"));
	result.push(binding("escape", "back", target, "Back to groups"));
	if (!disabled && codec) {
		result.push(binding("enter", "activate", target, `Activate ${target.path}`));
		if (codec.mode === "boolean" || codec.mode === "select")
			result.push(binding("space", "activate", target, "Activate field"));
		else result.push(binding("backspace", "backspace", target, "Edit and delete before"));
	}
	return result;
}

function binding(input: string, action: string, target: InteractionTarget, label: string): DefaultBindingContribution {
	return { input, interaction: { action, target }, label };
}

export function visibleOptions(state: MutableEditState): readonly FormbarOption[] {
	return filteredOptions(state).slice(state.optionOffset, state.optionOffset + 8);
}

export function filteredOptions(state: MutableEditState): readonly FormbarOption[] {
	const search = state.search.toLowerCase();
	return (state.codec?.options ?? []).filter(({ title }) => title.toLowerCase().includes(search));
}

export function firstEnabled(options: readonly FormbarOption[]): number {
	const index = options.findIndex(({ disabled }) => disabled !== true);
	return index < 0 ? 0 : index;
}

export function nextEnabled(options: readonly FormbarOption[], current: number, delta: number): number {
	if (options.length === 0) return current;
	let index = current;
	for (let count = 0; count < options.length; count += 1) {
		index = (index + delta + options.length) % options.length;
		if (options[index]?.disabled !== true) return index;
	}
	return current;
}

export function availableActions(
	capability: ScopedInteractionCapability,
	session: FormNavigationSession,
): readonly string[] {
	const target = session.getSelectedTarget();
	if (!target) return [];
	return INPUTS.flatMap(([input, physical]) => {
		const value = capability.getEffectiveBinding(input);
		return value.status === "bound" && sameTarget(value.interaction.target, target)
			? [`${physical}: ${value.label}`]
			: [];
	});
}

export function sameTarget(left: InteractionTarget | undefined, right: InteractionTarget | undefined): boolean {
	if (!left || !right || left.kind !== right.kind) return false;
	return left.kind === "group" ? left.id === (right as typeof left).id : left.path === (right as typeof left).path;
}
