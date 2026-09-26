import { type BoundSupplier, boundSubmitStore, boundSubmitSupplier } from "./bound-submit-supplier.js";
import type { FormApi } from "./contracts.js";
import type { FinalGeneration } from "./final-generation.js";
import { originalIssueSource } from "./issue-provenance.js";
import { sameOwnedJson } from "./owned-issue-snapshot.js";
import { scopedLifecycleRevision } from "./scoped-sync.js";
import type { FormState, FormStateCapture, ValidationIssue } from "./state.js";
import { snapshotOwnership } from "./store.js";
import type { FormStore } from "./store.js";
import type { SubmitStructuralWitness } from "./submit-adapter-contract.js";
import { clone } from "./submit-candidate-safety.js";

export interface BoundAttemptReceipt {
	/** Other retained and candidate diagnostics remain independently visible. */
	readonly covers: (issue: ValidationIssue) => boolean;
}

const issuedReceipts = new WeakMap<BoundAttemptReceipt, FormStore<unknown, unknown>>();

/** A caller-shaped object or an earlier form snapshot cannot authorize retained diagnostics. */
export function receiptCoversRetainedIssue(
	receipt: BoundAttemptReceipt | undefined,
	state: FormState<unknown, unknown>,
	issue: ValidationIssue,
): boolean {
	if (!receipt || issuedReceipts.get(receipt)?.getState() !== state) return false;
	return receipt.covers(issue);
}

interface Baseline {
	readonly state: FormState<unknown, unknown>;
	readonly issues: readonly ValidationIssue[];
	readonly owner: NonNullable<ReturnType<typeof snapshotOwnership>>;
	readonly values: ReturnType<typeof clone>["value"];
	readonly lifecycle: number;
}

interface BoundPreflight {
	readonly current: () => boolean;
	readonly checked: (
		capture: FormStateCapture<unknown, unknown>,
		plan: SubmitStructuralWitness,
		submitId: string,
		revision: number,
		current: () => boolean,
	) => ((generation: FinalGeneration) => BoundAttemptReceipt | undefined) | undefined;
}

function sameIssues(state: FormState<unknown, unknown>, issues: readonly ValidationIssue[]): boolean {
	return state.issues.length === issues.length && issues.every((issue, index) => state.issues[index] === issue);
}

function sameBaseline(form: FormApi<unknown, unknown>, baseline: Baseline): boolean {
	const state = form.getState();
	const owner = snapshotOwnership(state);
	const values = baseline.values as { data: unknown; uiState: unknown; fieldPolicy: unknown };
	return (
		!form.isDisposed() &&
		scopedLifecycleRevision(form) === baseline.lifecycle &&
		owner?.store === baseline.owner.store &&
		owner.owned &&
		owner.write === baseline.owner.write &&
		owner.epoch === baseline.owner.epoch &&
		owner.failure === baseline.owner.failure &&
		state.meta.stage === baseline.state.meta.stage &&
		sameOwnedJson(state.data, values.data) &&
		sameOwnedJson(state.uiState, values.uiState) &&
		sameOwnedJson(state.fieldPolicy, values.fieldPolicy) &&
		sameIssues(state, baseline.issues)
	);
}

function producerClaims(
	store: FormStore<unknown, unknown>,
	baseline: Baseline,
	supplier: BoundSupplier,
): Map<ValidationIssue, NonNullable<ReturnType<BoundSupplier["preflight"]>>> {
	const claims = new Map<ValidationIssue, NonNullable<ReturnType<BoundSupplier["preflight"]>>>();
	for (const issue of baseline.issues) {
		const source = originalIssueSource(issue);
		if (!source?.capture) continue;
		const producer = snapshotOwnership(source.capture.state);
		if (
			producer?.store !== store ||
			producer.write !== baseline.owner.write ||
			producer.epoch !== baseline.owner.epoch ||
			producer.failure !== baseline.owner.failure ||
			source.capture.state.meta.stage !== baseline.state.meta.stage ||
			!sameOwnedJson(source.capture.state.data, baseline.state.data) ||
			!sameOwnedJson(source.capture.state.uiState, baseline.state.uiState) ||
			!sameOwnedJson(source.capture.state.fieldPolicy, baseline.state.fieldPolicy)
		)
			continue;
		const claim = supplier.preflight(issue);
		if (claim) claims.set(issue, claim);
	}
	return claims;
}

function checkedBoundAttempt(
	store: FormStore<unknown, unknown>,
	claims: ReturnType<typeof producerClaims>,
	current: () => boolean,
): BoundPreflight["checked"] {
	return (capture, plan, submitId, revision, guarded) => {
		if (!current() || capture.state !== store.getState() || !guarded()) return;
		let certified: Set<ValidationIssue>;
		try {
			certified = new Set([...claims].filter(([, claim]) => claim(capture, plan)).map(([issue]) => issue));
		} catch {
			return;
		}
		if (!certified.size) return;
		return (generation) => {
			const now = store.getState();
			if (
				!current() ||
				!guarded() ||
				!generation.current() ||
				now.attemptValidation?.submitId !== submitId ||
				now.attemptValidation.revision !== revision
			)
				return;
			const receipt = Object.freeze({
				covers: (issue: ValidationIssue) =>
					certified.has(issue) &&
					current() &&
					guarded() &&
					generation.current() &&
					store.getState().attemptValidation?.submitId === submitId &&
					store.getState().attemptValidation?.revision === revision,
			});
			issuedReceipts.set(receipt, store);
			return receipt;
		};
	};
}

/** No FormApi capture: the original certified emission must still be current before any pipeline hook runs. */
export function beginBoundAttempt(form: FormApi<unknown, unknown>): BoundPreflight | undefined {
	const store = boundSubmitStore(form);
	const supplier = boundSubmitSupplier(form);
	if (!store || !supplier || store.getState() !== form.getState()) return;
	const state = store.getState();
	const owner = snapshotOwnership(state);
	if (!owner?.owned || owner.store !== store) return;
	let values: ReturnType<typeof clone>["value"];
	try {
		values = clone({ data: state.data, uiState: state.uiState, fieldPolicy: state.fieldPolicy }).value;
	} catch {
		return;
	}
	const baseline: Baseline = {
		state,
		owner,
		issues: [...state.issues],
		values,
		lifecycle: scopedLifecycleRevision(form),
	};
	let claims: ReturnType<typeof producerClaims>;
	try {
		claims = producerClaims(store, baseline, supplier);
	} catch {
		return;
	}
	if (!claims.size || !sameBaseline(form, baseline)) return;
	const current = () => sameBaseline(form, baseline);
	return { current, checked: checkedBoundAttempt(store, claims, current) };
}
