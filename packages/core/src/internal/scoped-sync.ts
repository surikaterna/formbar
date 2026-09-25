/** Trusted same-realm integration adapter; importable, not a malicious-JS sandbox. */
export { registerScopedSync, scopedCaptureCurrent, scopedLifecycleRevision } from "../scoped-sync.js";
export { scopedCaptureReceipt } from "../scoped-capture-receipt.js";
export type {
	ScopedSyncHost,
	ScopedFieldInstance,
	ScopedFieldIssueInput,
	ScopedValidationInput,
} from "../scoped-sync.js";
