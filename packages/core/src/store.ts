import { rebaseAttemptIssues } from "./attempt-issues.js";
import { structuredEqual } from "./equality.js";
import { ownIssues } from "./issue-ownership.js";
import { ownNonIssueState } from "./owned-issue-snapshot.js";
import type { FormState } from "./state.js";
import type { ValidationIssue } from "./state.js";
import { type StateStrategy, Transaction, defaultStrategy } from "./transaction.js";
import { normalizeIssues } from "./validation.js";

export type StateListener<TData, TUi> = (state: FormState<TData, TUi>) => void;
export class OwnedNotificationOverflow extends Error {
	constructor() {
		super("OWNED_NOTIFICATION_OVERFLOW");
	}
}
const MAX_OWNED_NOTIFICATIONS = 1024;
const issueOnly = Symbol("internal issue-only publication");
const enableOwnership = Symbol("internal nonissue ownership activation");
const snapshotOwners = new WeakMap<
	object,
	{
		readonly store: object;
		readonly write: number;
		readonly epoch: number;
		readonly failure: number;
		readonly owned: boolean;
	}
>();
const disposedStores = new WeakSet<object>();

/** Private provenance for captured state; never infer ownership from reference equality. */
export function snapshotOwnership(state: object):
	| {
			readonly store: object;
			readonly write: number;
			readonly epoch: number;
			readonly failure: number;
			readonly owned: boolean;
	  }
	| undefined {
	const owner = snapshotOwners.get(state);
	return owner && !disposedStores.has(owner.store) ? owner : undefined;
}

/** Internal host seam; deliberately absent from the public package entry. */
export function publishIssueOnly<TData, TUi>(store: FormStore<TData, TUi>, issues: readonly ValidationIssue[]): void {
	store[issueOnly](issues);
}

/** Opt-in trusted-host boundary. A failed activation leaves the store and subscriptions untouched. */
export function ownStoreBeforeScheduling<TData, TUi>(store: FormStore<TData, TUi>, invalidate?: () => void): void {
	store[enableOwnership](invalidate);
}

/** Synchronous reactive store with transactional semantics — only one transaction active at a time. */
export class FormStore<TData, TUi> {
	private _state: FormState<TData, TUi>;
	private _listeners: Set<StateListener<TData, TUi>> = new Set();
	private _activeTransaction: Transaction<TData, TUi> | null = null;
	private _strategy: StateStrategy;
	private _disposed = false;
	private _owned = false;
	private _ownedMode = false;
	private _write = 0;
	private _epoch = 0;
	private _failure = 0;
	private _notifyingOwned = false;

	constructor(initialState: FormState<TData, TUi>, strategy?: StateStrategy, ownedScheduling = false) {
		if (ownedScheduling && strategy !== undefined && strategy !== defaultStrategy)
			throw new Error("OWNED_STATE_UNSUPPORTED");
		this._state = ownedScheduling ? Object.freeze(ownNonIssueState(initialState)) : this._ownStateIssues(initialState);
		this._strategy = strategy ?? defaultStrategy;
		this._ownedMode = ownedScheduling;
		this._owned = ownedScheduling;
		this._stamp();
	}

	[enableOwnership](invalidate?: () => void): void {
		if (this._disposed || this._activeTransaction || this._strategy !== defaultStrategy)
			throw new Error("OWNED_STATE_UNSUPPORTED");
		if (this._ownedMode) return;
		const next = Object.freeze(ownNonIssueState(this._state));
		this._state = next;
		this._ownedMode = true;
		this._owned = true;
		this._epoch++;
		this._stamp();
		invalidate?.();
		this._notifyListeners();
	}

	/** Return the current frozen state snapshot. */
	getState(): FormState<TData, TUi> {
		return this._state;
	}

	isOwnedSchedulingMode(): boolean {
		return this._ownedMode;
	}

	/** Internal reset preflight: reject unsupported replacements before aborting pending work. */
	preflightOwnedReplacement(data: TData, uiState: TUi): void {
		if (!this._ownedMode) return;
		ownNonIssueState({ ...this._state, data, uiState });
	}

	/** Clone current state into a mutable draft context. Only one transaction may be active at a time. */
	beginTransaction(): Transaction<TData, TUi> {
		if (this._activeTransaction) {
			throw new Error("Cannot begin transaction while another is active");
		}
		this._activeTransaction = new Transaction<TData, TUi>(this._state, this._strategy);
		return this._activeTransaction;
	}

	/** Apply draft state and notify subscribers if state was mutated. */
	commitTransaction(tx: Transaction<TData, TUi>, onCommitted?: (state: FormState<TData, TUi>) => void): void {
		if (tx !== this._activeTransaction) {
			throw new Error("Transaction does not belong to this store");
		}
		const committed = tx.dirty ? this._ownStateIssues(tx.draftState) : tx.draftState;
		const candidate = tx.dirty && this._ownedMode ? ownNonIssueState(committed) : committed;
		const nextState = structuredEqual(this._state.fieldPolicy, candidate.fieldPolicy)
			? { ...candidate, fieldPolicy: this._state.fieldPolicy }
			: candidate;
		tx.commit();
		this._activeTransaction = null;

		if (!tx.dirty) {
			return;
		}

		const rebased = rebaseAttemptIssues(nextState);
		if (this._ownedMode && rebased.attemptValidation) {
			Object.freeze(rebased.attemptValidation.renderableIssues);
			Object.freeze(rebased.attemptValidation);
		}
		this._state = this._ownedMode ? Object.freeze(rebased) : rebased;
		this._owned = this._ownedMode;
		this._write++;
		if (this._ownedMode) this._epoch++;
		this._stamp();
		onCommitted?.(this._state);
		this._notifyListeners();
	}

	/** Explicit internal trusted-host issue-only publication; never falls back to a transaction. */
	[issueOnly](issues: readonly ValidationIssue[]): void {
		try {
			this._publishIssues(issues);
		} catch (error) {
			this._failure++;
			this._stamp();
			throw error;
		}
	}

	private _publishIssues(issues: readonly ValidationIssue[]): void {
		if (this._disposed || this._activeTransaction || this._strategy !== defaultStrategy)
			throw new Error("ISSUE_ONLY_UNSUPPORTED_STATE");
		const incoming = ownIssues(issues);
		const base = this._owned ? this._state : ownNonIssueState(this._state);
		const next = rebaseAttemptIssues({ ...base, issues: Object.freeze([...normalizeIssues(incoming)]) });
		if (next.attemptValidation) {
			Object.freeze(next.attemptValidation.renderableIssues);
			Object.freeze(next.attemptValidation);
		}
		this._state = Object.freeze(next);
		if (!this._owned) this._epoch++;
		this._owned = true;
		this._stamp();
		this._notifyListeners();
	}

	private _stamp(): void {
		snapshotOwners.set(this._state, {
			store: this,
			write: this._write,
			epoch: this._epoch,
			failure: this._failure,
			owned: this._ownedMode,
		});
	}

	private _ownStateIssues(state: FormState<TData, TUi>): FormState<TData, TUi> {
		const issues = ownIssues(state.issues);
		const attempt = state.attemptValidation;
		if (!attempt) return { ...state, issues };
		const attemptIssues = ownIssues(attempt.issues);
		return rebaseAttemptIssues({
			...state,
			issues,
			attemptValidation: { ...attempt, issues: attemptIssues, renderableIssues: ownIssues(attempt.renderableIssues) },
		});
	}

	/** Discard draft state without notifying subscribers. */
	rollbackTransaction(tx: Transaction<TData, TUi>): void {
		if (tx !== this._activeTransaction) {
			throw new Error("Transaction does not belong to this store");
		}
		tx.rollback();
		this._activeTransaction = null;
	}

	/** Register a listener called on each commit. Returns an unsubscribe function. */
	subscribe(listener: StateListener<TData, TUi>): () => void {
		if (this._disposed) return () => {};
		this._listeners.add(listener);
		return () => {
			this._listeners.delete(listener);
		};
	}

	/** Clear all subscriptions and roll back an active transaction. */
	dispose(): void {
		if (this._disposed) return;
		this._disposed = true;
		disposedStores.add(this);
		this._listeners.clear();
		if (this._activeTransaction && this._activeTransaction.status === "active") {
			this._activeTransaction.rollback();
		}
		this._activeTransaction = null;
	}

	private _notifyListeners(): void {
		if (this._disposed) return;
		if (this._ownedMode) {
			this._notifyOwnedListeners();
			return;
		}
		const state = this._state;
		for (const listener of this._listeners) {
			try {
				listener(state);
			} catch {
				// Swallow subscriber errors to ensure all listeners are notified
			}
		}
	}

	private _notifyOwnedListeners(): void {
		if (this._notifyingOwned) return;
		this._notifyingOwned = true;
		const delivered = new Map<StateListener<TData, TUi>, FormState<TData, TUi>>();
		let count = 0;
		try {
			while (!this._disposed) {
				let invoked = false;
				for (const listener of [...this._listeners]) {
					if (this._disposed) return;
					if (!this._listeners.has(listener) || delivered.get(listener) === this._state) continue;
					if (count++ >= MAX_OWNED_NOTIFICATIONS) throw new OwnedNotificationOverflow();
					const current = this._state;
					delivered.set(listener, current);
					invoked = true;
					try {
						listener(current);
					} catch {
						// Listener failures do not prevent other subscribers from observing the current state.
					}
				}
				if (!invoked) return;
			}
		} finally {
			this._notifyingOwned = false;
		}
	}
}
