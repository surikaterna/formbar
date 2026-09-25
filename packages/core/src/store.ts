import { rebaseAttemptIssues } from "./attempt-issues.js";
import { structuredEqual } from "./equality.js";
import type { FormState } from "./state.js";
import { type StateStrategy, Transaction, defaultStrategy } from "./transaction.js";

export type StateListener<TData, TUi> = (state: FormState<TData, TUi>) => void;

/** Synchronous reactive store with transactional semantics — only one transaction active at a time. */
export class FormStore<TData, TUi> {
	private _state: FormState<TData, TUi>;
	private _listeners: Set<StateListener<TData, TUi>> = new Set();
	private _activeTransaction: Transaction<TData, TUi> | null = null;
	private _strategy: StateStrategy;
	private _disposed = false;

	constructor(initialState: FormState<TData, TUi>, strategy?: StateStrategy) {
		this._state = initialState;
		this._strategy = strategy ?? defaultStrategy;
	}

	/** Return the current frozen state snapshot. */
	getState(): FormState<TData, TUi> {
		return this._state;
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
		const committed = tx.commit();
		const nextState = structuredEqual(this._state.fieldPolicy, committed.fieldPolicy)
			? { ...committed, fieldPolicy: this._state.fieldPolicy }
			: committed;
		this._activeTransaction = null;

		if (!tx.dirty) {
			return;
		}

		this._state = rebaseAttemptIssues(nextState);
		onCommitted?.(this._state);
		this._notifyListeners();
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
		this._listeners.clear();
		if (this._activeTransaction && this._activeTransaction.status === "active") {
			this._activeTransaction.rollback();
		}
		this._activeTransaction = null;
	}

	private _notifyListeners(): void {
		if (this._disposed) return;
		const state = this._state;
		for (const listener of this._listeners) {
			try {
				listener(state);
			} catch {
				// Swallow subscriber errors to ensure all listeners are notified
			}
		}
	}
}
