import type { FormApi } from "@formbar/core";
import { applyCodecFailure, applyWriteFailure, validateSelectValue, writeCodecValue } from "./codec-runtime.js";
import { type MutableEditState, resetEditState } from "./edit-state.js";
import { visibleOptions } from "./renderer-bindings.js";
import { commitDraft } from "./renderer-form-state.js";

export function flushForSubmit<TData, TUi>(state: MutableEditState, form: FormApi<TData, TUi>): boolean {
	if (state.adapterFailed) return false;
	if (state.mode === "navigation") return true;
	if (state.mode === "editing") return commitDraft(state, form);
	if (state.stale) {
		state.error = "Value changed externally; cancel and retry";
		return false;
	}
	const option = visibleOptions(state)[state.optionIndex];
	if (!option || option.disabled === true || state.path === undefined || !state.codec) {
		state.error = "No enabled option available";
		return false;
	}
	const checked = validateSelectValue(state.codec, option.value);
	if (checked.kind !== "success") {
		applyCodecFailure(state, checked);
		return false;
	}
	state.wroteCanonical = true;
	if (!writeCodecValue(form, state.path, checked.value).ok) {
		applyWriteFailure(state);
		return false;
	}
	resetEditState(state);
	return true;
}
