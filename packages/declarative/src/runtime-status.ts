import type { FormStateCapture } from "@formbar/core";
import type { RuntimeFormStatus } from "./runtime-contracts.js";

export function resolveFormStatus(capture: FormStateCapture<unknown, unknown>): RuntimeFormStatus {
	const state = capture.state;
	return Object.freeze({
		valid: !state.issues.some((issue) => issue.severity === "error"),
		validating: state.meta.validation.validating === true,
		submitting: state.meta.submission?.status === "running",
		dirty: capture.isFormDirty(),
		touched: Object.values(state.fieldMeta).some((entry) => entry.touched),
		submitted: state.meta.submitted === true,
	});
}
