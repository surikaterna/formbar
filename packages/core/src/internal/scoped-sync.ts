/** Trusted same-realm integration adapter; importable, not a malicious-JS sandbox. */
export { registerScopedSync, scopedCaptureCurrent, scopedLifecycleRevision } from "../scoped-sync.js";
export { scopedCaptureReceipt } from "../scoped-capture-receipt.js";
export { activateOwnedSchedulingBoundary } from "../owned-scheduling-boundary.js";
export { assertScopedAsyncIds, registerScopedAsync } from "../scoped-async.js";
export { runScopedCandidate } from "../scoped-async-candidate.js";
export { issueEmissionId } from "../issue-provenance.js";
export type { ScopedAsyncField, ScopedAsyncHost } from "../scoped-async.js";
export type {
	ScopedSyncHost,
	ScopedFieldInstance,
	ScopedFieldIssueInput,
	ScopedValidationInput,
} from "../scoped-sync.js";
