import type { FormApi } from "@formbar/core";
import { applyCodecFailure, applyWriteFailure, readWriteResult, writeCodecValue } from "./codec-runtime.js";
import { type MutableEditState, resetEditState } from "./edit-state.js";
import type { InteractionTarget } from "./interaction.js";
import type { FormNavigationSession } from "./navigation-session.js";
import { sameTarget } from "./renderer-bindings.js";

export function navigationAction<TData, TUi>(
	action: string,
	form: FormApi<TData, TUi>,
	session: FormNavigationSession,
	target: Extract<InteractionTarget, { kind: "field" }>,
): boolean {
	if (action === "back") {
		const changed = session.back(target);
		if (changed) form.fieldDynamic(target.path).handleBlur();
		return changed;
	}
	if (action !== "next" && action !== "previous") return false;
	const before = session.getSelectedTarget();
	const handled = action === "next" ? session.next(target) : session.previous(target);
	if (handled && !sameTarget(before, session.getSelectedTarget())) form.fieldDynamic(target.path).handleBlur();
	return handled;
}

export function moveNavigation(action: string, session: FormNavigationSession, target: InteractionTarget): boolean {
	if (action === "next") return session.next(target);
	if (action === "previous") return session.previous(target);
	return false;
}

export function advanceWithBlur<TData, TUi>(
	form: FormApi<TData, TUi>,
	session: FormNavigationSession,
	target: Extract<InteractionTarget, { kind: "field" }>,
): void {
	const before = session.getSelectedTarget();
	session.advance(target);
	if (!sameTarget(before, session.getSelectedTarget())) form.fieldDynamic(target.path).handleBlur();
}

export function canonicalChanged<TData, TUi>(
	state: MutableEditState,
	form: FormApi<TData, TUi>,
	emit: () => void,
): void {
	if (state.mode !== "navigation" && !state.codec?.masked && state.path !== undefined) {
		if (state.wroteCanonical) state.wroteCanonical = false;
		else if (!Object.is(form.fieldDynamic(state.path).get(), state.canonical)) state.stale = true;
	}
	emit();
}

export function commitDraft<TData, TUi>(state: MutableEditState, form: FormApi<TData, TUi>): boolean {
	if (state.stale) {
		state.error = "Value changed externally; cancel and retry";
		return false;
	}
	if (!state.codec || state.path === undefined) {
		state.error = "Field adapter failed";
		state.adapterFailed = true;
		return false;
	}
	const result = readWriteResult(state.codec, state.draft, state.canonical);
	if (result.kind !== "success") {
		applyCodecFailure(state, result);
		return false;
	}
	state.wroteCanonical = true;
	if (!writeCodecValue(form, state.path, result.value).ok) {
		applyWriteFailure(state);
		return false;
	}
	resetEditState(state);
	return true;
}
