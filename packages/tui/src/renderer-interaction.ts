import type { FormApi } from "@formbar/core";
import { graphemes, insertAtCaret, moveCaret, removeAt, removeBefore } from "./caret.js";
import { once, runReverse } from "./cleanup.js";
import {
	acceptsCodecDraft,
	applyCodecFailure,
	applyWriteFailure,
	markAdapterFailure,
	readDraftResult,
	validateSelectValue,
	writeCodecValue,
} from "./codec-runtime.js";
import { type MutableEditState, editSnapshot, emptyEditState, resetEditState } from "./edit-state.js";
import type { TuiFieldCodec } from "./field-adapters.js";
import type {
	InteractionCleanup,
	InteractionTarget,
	LocalInteraction,
	ScopedInteractionCapability,
	TextInputSource,
} from "./interaction.js";
import { type FormNavigationSession, createFormNavigationSession } from "./navigation-session.js";
import type { NavigationModel } from "./navigation.js";
import {
	availableActions,
	filteredOptions,
	firstEnabled,
	nextEnabled,
	sameTarget,
	visibleOptions,
} from "./renderer-bindings.js";
import {
	advanceWithBlur,
	canonicalChanged,
	commitDraft,
	moveNavigation,
	navigationAction,
} from "./renderer-form-state.js";
import type { RendererInteraction } from "./renderer-interaction-contract.js";
import { type InteractionRuntime, createInteractionRuntime } from "./renderer-runtime.js";
import { flushForSubmit } from "./renderer-submit-flush.js";
import type { SubmissionCallbackRefs, SubmissionController } from "./submission-controller.js";
import { isSafeTextChunk } from "./terminal-text.js";

export type { RendererInteraction } from "./renderer-interaction-contract.js";

interface MountInputs<TData, TUi> {
	readonly navigation: NavigationModel;
	readonly capability: ScopedInteractionCapability;
	readonly textInput: TextInputSource;
	readonly form: FormApi<TData, TUi>;
	readonly codecs: ReadonlyMap<string, TuiFieldCodec>;
	readonly disabled: ReadonlySet<string>;
	readonly callbacks: SubmissionCallbackRefs<TData, TUi>;
}

export function mountRendererInteraction<TData, TUi>(inputs: MountInputs<TData, TUi>): RendererInteraction {
	const session = createFormNavigationSession(inputs.navigation);
	const state = emptyEditState();
	const listeners = new Set<() => void>();
	const cleanups: InteractionCleanup[] = [() => session.dispose()];
	const runtime = createInteractionRuntime(inputs, session, state, listeners, (interaction, submission) =>
		handleAction(interaction, state, inputs, session, submission),
	);
	try {
		installRuntime(inputs, session, state, runtime, cleanups);
	} catch (error) {
		runtime.disposed.value = true;
		runReverse(cleanups);
		throw error;
	}
	return createFacade(inputs, session, state, listeners, cleanups, runtime);
}

function installRuntime<TData, TUi>(
	inputs: MountInputs<TData, TUi>,
	session: FormNavigationSession,
	state: MutableEditState,
	runtime: InteractionRuntime,
	cleanups: InteractionCleanup[],
): void {
	cleanups.push(inputs.capability.registerTargets(targets(inputs.navigation, runtime.act)));
	cleanups.push(inputs.capability.registerActions(actions(runtime.act)));
	runtime.refresh();
	cleanups.push(runtime.releaseDefaults);
	cleanups.push(inputs.capability.subscribe(runtime.emit));
	cleanups.push(
		session.subscribe(() => {
			runtime.refresh();
			runtime.emit();
		}),
	);
	cleanups.push(inputs.textInput.subscribe((text) => directText(text, state, inputs, session, runtime)));
}

function directText<TData, TUi>(
	text: string,
	state: MutableEditState,
	inputs: MountInputs<TData, TUi>,
	session: FormNavigationSession,
	runtime: InteractionRuntime,
): void {
	let handled = false;
	try {
		handled = !runtime.disposed.value && isSafeTextChunk(text) && handleText(text, state, inputs, session);
	} catch {
		markAdapterFailure(state);
		handled = true;
	}
	if (handled) {
		runtime.refresh();
		runtime.emit();
	}
}

function createFacade<TData, TUi>(
	inputs: MountInputs<TData, TUi>,
	session: FormNavigationSession,
	state: MutableEditState,
	listeners: Set<() => void>,
	cleanups: readonly InteractionCleanup[],
	runtime: InteractionRuntime,
): RendererInteraction {
	return {
		session,
		getAvailableActions: () => availableActions(inputs.capability, session),
		getEditSnapshot: () => editSnapshot(state),
		getVisibleOptions: () => visibleOptions(state),
		isMasked: (path) => inputs.codecs.get(path)?.masked === true,
		getOptionTitle: (path, value) =>
			inputs.codecs.get(path)?.options?.find((option) => Object.is(option.value, value))?.title,
		getSubmissionSnapshot: runtime.submission.getSnapshot,
		getRevision: runtime.getRevision,
		notifyFormChange: () => {
			runtime.submission.observe(inputs.form.getState());
			canonicalChanged(state, inputs.form, runtime.emit);
		},
		subscribe(listener) {
			if (runtime.disposed.value) return () => undefined;
			listeners.add(listener);
			return once(() => listeners.delete(listener));
		},
		dispose() {
			if (runtime.disposed.value) return;
			runtime.disposed.value = true;
			runtime.submission.dispose();
			runReverse(cleanups);
			listeners.clear();
		},
	};
}

function targets(navigation: NavigationModel, act: (value: LocalInteraction) => boolean) {
	return navigation.targets.map((target) => ({ target, invoke: (action: string) => act({ action, target }) }));
}

function actions(act: (value: LocalInteraction) => boolean) {
	return [
		"activate",
		"back",
		"next",
		"previous",
		"backspace",
		"delete",
		"left",
		"right",
		"select-next",
		"select-previous",
		"submit",
	].map((id) => ({ id, invoke: act }));
}

function handleAction<TData, TUi>(
	action: LocalInteraction,
	state: MutableEditState,
	inputs: MountInputs<TData, TUi>,
	session: FormNavigationSession,
	submission: SubmissionController,
): boolean {
	const selected = session.getSelectedTarget();
	if (!selected || !sameTarget(action.target, selected)) return false;
	if (action.action === "submit") {
		if (!flushForSubmit(state, inputs.form)) return true;
		return submission.submit();
	}
	if (selected.kind === "group")
		return action.action === "activate" ? session.activate(selected) : moveNavigation(action.action, session, selected);
	if (state.mode === "editing") return editAction(action.action, state, inputs.form, session, selected);
	if (state.mode === "select") return selectAction(action.action, state, inputs.form, session, selected);
	if (inputs.disabled.has(selected.path)) return navigationAction(action.action, inputs.form, session, selected);
	if (action.action === "activate") return activateField(state, inputs, selected.path);
	if (action.action === "backspace" && inputs.codecs.get(selected.path)?.mode === "text") {
		if (!beginField(state, inputs, selected.path)) return state.error !== undefined;
		removeBefore(state, "draft");
		return true;
	}
	return navigationAction(action.action, inputs.form, session, selected);
}

function activateField<TData, TUi>(state: MutableEditState, inputs: MountInputs<TData, TUi>, path: string): boolean {
	const codec = inputs.codecs.get(path);
	if (!codec) return false;
	if (codec.mode === "boolean") {
		state.path = path;
		state.codec = codec;
		const current = readDraftResult(codec, inputs.form.fieldDynamic(path).get());
		if (current.kind !== "success" || typeof current.value !== "boolean") {
			applyCodecFailure(state, current.kind === "success" ? { kind: "malformed" } : current);
			return true;
		}
		const next = !current.value;
		const checked = readDraftResult(codec, next);
		if (checked.kind !== "success" || checked.value !== next) {
			applyCodecFailure(state, checked.kind === "success" ? { kind: "malformed" } : checked);
			return true;
		}
		state.wroteCanonical = true;
		if (!writeCodecValue(inputs.form, path, next).ok) {
			applyWriteFailure(state);
			return true;
		}
		resetEditState(state);
		return true;
	}
	beginField(state, inputs, path);
	return true;
}

function beginField<TData, TUi>(state: MutableEditState, inputs: MountInputs<TData, TUi>, path: string): boolean {
	const codec = inputs.codecs.get(path);
	if (!codec) return false;
	const canonical = codec.masked ? undefined : inputs.form.fieldDynamic(path).get();
	state.codec = codec;
	state.path = path;
	state.canonical = canonical;
	const converted = readDraftResult(codec, canonical);
	if (converted.kind !== "success" || typeof converted.value !== "string") {
		applyCodecFailure(state, converted.kind === "success" ? { kind: "malformed" } : converted);
		return false;
	}
	state.mode = codec.mode === "select" ? "select" : "editing";
	state.draft = converted.value;
	state.search = "";
	state.caret = state.mode === "select" ? 0 : graphemes(state.draft).length;
	const canonicalIndex = codec.options?.findIndex((option) => Object.is(option.value, canonical)) ?? -1;
	state.optionOffset = canonicalIndex >= 8 ? canonicalIndex - 7 : 0;
	state.optionIndex = canonicalIndex >= 0 ? canonicalIndex - state.optionOffset : firstEnabled(visibleOptions(state));
	state.error = undefined;
	state.stale = false;
	state.adapterFailed = false;
	return true;
}

function editAction<TData, TUi>(
	action: string,
	state: MutableEditState,
	form: FormApi<TData, TUi>,
	session: FormNavigationSession,
	target: Extract<InteractionTarget, { kind: "field" }>,
): boolean {
	if (action === "back") {
		resetEditState(state);
		return true;
	}
	if (action === "backspace") {
		removeBefore(state, "draft");
		return true;
	}
	if (action === "delete") {
		removeAt(state, "draft");
		return true;
	}
	if (action === "left" || action === "right") {
		moveCaret(state, action === "left" ? -1 : 1);
		return true;
	}
	if (action !== "activate" && action !== "next") return false;
	if (!commitDraft(state, form)) return true;
	if (action === "next") advanceWithBlur(form, session, target);
	return true;
}

function selectAction<TData, TUi>(
	action: string,
	state: MutableEditState,
	form: FormApi<TData, TUi>,
	session: FormNavigationSession,
	target: Extract<InteractionTarget, { kind: "field" }>,
): boolean {
	const local = selectLocalAction(action, state);
	if (local !== undefined) return local;
	if (action !== "activate" && action !== "next") return false;
	const option = visibleOptions(state)[state.optionIndex];
	if (!option) return true;
	if (option.disabled === true || !state.codec) return true;
	const checked = validateSelectValue(state.codec, option.value);
	if (checked.kind !== "success") {
		applyCodecFailure(state, checked);
		return true;
	}
	state.wroteCanonical = true;
	if (!writeCodecValue(form, target.path, checked.value).ok) {
		applyWriteFailure(state);
		return true;
	}
	resetEditState(state);
	if (action === "next") advanceWithBlur(form, session, target);
	return true;
}

function selectLocalAction(action: string, state: MutableEditState): boolean | undefined {
	if (action === "back") resetEditState(state);
	else if (action === "backspace" || action === "delete") {
		if (action === "backspace") removeBefore(state, "search");
		else removeAt(state, "search");
		state.optionOffset = 0;
		state.optionIndex = firstEnabled(visibleOptions(state));
	} else if (action === "left" || action === "right") moveCaret(state, action === "left" ? -1 : 1);
	else if (action === "select-next" || action === "select-previous")
		moveOption(state, action === "select-next" ? 1 : -1);
	else return undefined;
	return true;
}

function handleText<TData, TUi>(
	text: string,
	state: MutableEditState,
	inputs: MountInputs<TData, TUi>,
	session: FormNavigationSession,
): boolean {
	const target = session.getSelectedTarget();
	if (target?.kind !== "field" || inputs.disabled.has(target.path)) return false;
	if (state.mode === "navigation" && !beginField(state, inputs, target.path)) return state.error !== undefined;
	if (state.mode === "editing") {
		const next = insertAtCaret(state.draft, text, state.caret);
		if (!state.codec) return false;
		const accepted = acceptsCodecDraft(state.codec, next);
		if (accepted.kind !== "success") {
			applyCodecFailure(state, accepted);
			return true;
		}
		if (!accepted.value) return false;
		state.draft = next;
	} else if (state.mode === "select") {
		state.search = insertAtCaret(state.search, text, state.caret);
		state.optionOffset = 0;
		state.optionIndex = firstEnabled(visibleOptions(state));
	} else return false;
	state.caret += graphemes(text).length;
	return true;
}

function moveOption(state: MutableEditState, delta: number): void {
	const options = filteredOptions(state);
	const current = state.optionOffset + state.optionIndex;
	const next = nextEnabled(options, current, delta);
	if (next < state.optionOffset) state.optionOffset = next;
	else if (next >= state.optionOffset + 8) state.optionOffset = next - 7;
	state.optionIndex = next - state.optionOffset;
}
