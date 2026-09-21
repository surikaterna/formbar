import { describe, expect, test, vi } from "vitest";
import type { FormState } from "../state.js";
import { FormStore } from "../store.js";
import { Transaction, defaultStrategy } from "../transaction.js";
import { deepFreeze } from "../utils.js";

function makeState(data: unknown = {}): FormState {
	return {
		data,
		uiState: {},
		meta: {
			validation: {},
		},
		fieldMeta: {},
		fieldPolicy: [],
		issues: [],
	};
}

describe("Transaction", () => {
	test("lifecycle: begin, mutate, commit produces new state", () => {
		const initial = makeState({ name: "Alice" });
		const tx = new Transaction(initial);

		tx.mutate((draft) => ({ ...draft, data: { name: "Bob" } }));
		const result = tx.commit();

		expect(tx.status).toBe("committed");
		expect((result.data as { name: string }).name).toBe("Bob");
	});

	test("rollback restores original state", () => {
		const initial = makeState({ name: "Alice" });
		const tx = new Transaction(initial);

		tx.mutate((draft) => ({ ...draft, data: { name: "Bob" } }));
		const result = tx.rollback();

		expect(tx.status).toBe("rolled-back");
		expect((result.data as { name: string }).name).toBe("Alice");
	});

	test("prevState is frozen and cannot be mutated", () => {
		const tx = new Transaction(makeState({ x: 1 }));

		expect(() => {
			(tx.prevState as { data: unknown }).data = "changed";
		}).toThrow();
	});

	test("committed transaction cannot be committed again", () => {
		const tx = new Transaction(makeState());
		tx.commit();
		expect(() => tx.commit()).toThrow(/committed/);
	});

	test("rolled-back transaction cannot be rolled back again", () => {
		const tx = new Transaction(makeState());
		tx.rollback();
		expect(() => tx.rollback()).toThrow(/rolled-back/);
	});

	test("committed transaction cannot be mutated", () => {
		const tx = new Transaction(makeState());
		tx.commit();
		expect(() => tx.mutate((d) => d)).toThrow(/committed/);
	});

	test("mutations do not affect prevState (isolation)", () => {
		const initial = makeState({ count: 0 });
		const tx = new Transaction(initial);

		tx.mutate((draft) => ({ ...draft, data: { count: 1 } }));
		tx.mutate((draft) => ({ ...draft, data: { count: 2 } }));

		expect((tx.prevState.data as { count: number }).count).toBe(0);
		expect((tx.draftState.data as { count: number }).count).toBe(2);
	});

	test("multiple mutations accumulate", () => {
		const tx = new Transaction(makeState({ a: 1 }));

		tx.mutate((draft) => ({ ...draft, data: { ...(draft.data as object), b: 2 } }));
		tx.mutate((draft) => ({ ...draft, data: { ...(draft.data as object), c: 3 } }));

		const result = tx.commit();
		expect(result.data).toEqual({ a: 1, b: 2, c: 3 });
	});
});

describe("FormStore", () => {
	test("commit notifies listeners", () => {
		const store = new FormStore(makeState());
		const listener = vi.fn(() => {});

		store.subscribe(listener);
		const tx = store.beginTransaction();
		tx.mutate((draft) => ({ ...draft, data: { changed: true } }));
		store.commitTransaction(tx);

		expect(listener).toHaveBeenCalledTimes(1);
	});

	test("rollback does not notify listeners", () => {
		const store = new FormStore(makeState());
		const listener = vi.fn(() => {});

		store.subscribe(listener);
		const tx = store.beginTransaction();
		tx.mutate((draft) => ({ ...draft, data: { changed: true } }));
		store.rollbackTransaction(tx);

		expect(listener).not.toHaveBeenCalled();
	});

	test("structural sharing: no notification if state unchanged", () => {
		const initial = makeState();
		const store = new FormStore(initial);
		const listener = vi.fn(() => {});

		store.subscribe(listener);
		const tx = store.beginTransaction();
		// No mutations — transaction is not dirty, so no notification
		store.commitTransaction(tx);

		expect(listener).not.toHaveBeenCalled();
	});

	test("no-op dispatch does not trigger subscribers", () => {
		const store = new FormStore(makeState({ v: 1 }));
		const listener = vi.fn(() => {});

		store.subscribe(listener);
		const tx = store.beginTransaction();
		// Commit without calling mutate — should not notify
		store.commitTransaction(tx);

		expect(listener).not.toHaveBeenCalled();
		// State should remain the original
		expect((store.getState().data as { v: number }).v).toBe(1);
	});

	test("nested transaction rejected", () => {
		const store = new FormStore(makeState());
		store.beginTransaction();

		expect(() => store.beginTransaction()).toThrow(/another is active/);
	});

	test("foreign transaction rejected on commit", () => {
		const store = new FormStore(makeState());
		const foreignTx = new Transaction(makeState());

		store.beginTransaction();
		expect(() => store.commitTransaction(foreignTx)).toThrow(/does not belong/);
	});

	test("foreign transaction rejected on rollback", () => {
		const store = new FormStore(makeState());
		const foreignTx = new Transaction(makeState());

		store.beginTransaction();
		expect(() => store.rollbackTransaction(foreignTx)).toThrow(/does not belong/);
	});

	test("dispose clears all listeners", () => {
		const store = new FormStore(makeState());
		const listener = vi.fn(() => {});

		store.subscribe(listener);
		store.dispose();

		const tx = store.beginTransaction();
		tx.mutate((draft) => ({ ...draft, data: { x: 1 } }));
		store.commitTransaction(tx);

		expect(listener).not.toHaveBeenCalled();
	});

	test("unsubscribe removes specific listener", () => {
		const store = new FormStore(makeState());
		const listener1 = vi.fn(() => {});
		const listener2 = vi.fn(() => {});

		const unsub1 = store.subscribe(listener1);
		store.subscribe(listener2);
		unsub1();

		const tx = store.beginTransaction();
		tx.mutate((draft) => ({ ...draft, data: { x: 1 } }));
		store.commitTransaction(tx);

		expect(listener1).not.toHaveBeenCalled();
		expect(listener2).toHaveBeenCalledTimes(1);
	});

	test("getState returns current state after commit", () => {
		const store = new FormStore(makeState({ v: 1 }));
		const tx = store.beginTransaction();
		tx.mutate((draft) => ({ ...draft, data: { v: 2 } }));
		store.commitTransaction(tx);

		expect((store.getState().data as { v: number }).v).toBe(2);
	});

	test("getState unchanged after rollback", () => {
		const store = new FormStore(makeState({ v: 1 }));
		const tx = store.beginTransaction();
		tx.mutate((draft) => ({ ...draft, data: { v: 2 } }));
		store.rollbackTransaction(tx);

		expect((store.getState().data as { v: number }).v).toBe(1);
	});
});

describe("defaultStrategy", () => {
	test("clone works without Illegal invocation", () => {
		const data = { name: "test", count: 42 };
		const cloned = defaultStrategy.clone(data);
		expect(cloned).toEqual(data);
		expect(cloned).not.toBe(data);
	});
});

describe("deepFreeze", () => {
	test("freezes nested objects", () => {
		const obj = deepFreeze({ a: { b: { c: 1 } } });
		expect(Object.isFrozen(obj)).toBe(true);
		expect(Object.isFrozen(obj.a)).toBe(true);
		expect(Object.isFrozen(obj.a.b)).toBe(true);
	});

	test("returns primitives unchanged", () => {
		expect(deepFreeze(42)).toBe(42);
		expect(deepFreeze(null)).toBe(null);
		expect(deepFreeze("str")).toBe("str");
	});
});
