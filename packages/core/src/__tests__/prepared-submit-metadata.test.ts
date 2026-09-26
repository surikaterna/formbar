import { expect, test } from "vitest";
import { executeSubmitPreparation } from "../pipeline.js";
import { FormStore, commitPreparedSubmit, snapshotOwnership } from "../store.js";

function fixture() {
	const store = new FormStore(
		{
			data: { secret: "draft" },
			uiState: { open: true },
			meta: { validation: {} },
			fieldMeta: {},
			fieldPolicy: [],
			issues: [],
		},
		undefined,
		true,
	);
	let revision = 0;
	const guard = {
		signal: new AbortController().signal,
		expectedRevision: 0,
		revision: () => revision,
		onCommittedMutation: () => {
			revision++;
		},
	};
	const context = {
		action: { type: "submit" as const },
		store,
		isSubmit: true,
		submitContext: { requestId: "metadata", at: "now" },
		options: {},
	};
	return { store, context, guard };
}

test("no-semantic submit publishes metadata without revoking the original owned epoch", () => {
	const { store, context, guard } = fixture();
	const before = store.getState();
	const stamps: unknown[] = [];
	store.subscribe((state) => stamps.push(snapshotOwnership(state)));
	expect(executeSubmitPreparation(context, guard).stage).toBe("prepared");
	expect(store.getState()).not.toBe(before);
	expect(stamps).toHaveLength(1);
	expect(snapshotOwnership(store.getState())).toEqual(snapshotOwnership(before));
	expect(guard.revision()).toBe(0);
});

test("same-value plugin write and reentrant notification cannot borrow metadata classification", () => {
	const { store, context, guard } = fixture();
	const before = snapshotOwnership(store.getState());
	const written = executeSubmitPreparation(
		{
			...context,
			plugins: [{ id: "same", evaluate: () => ({ writes: [{ path: "secret", value: "draft", mode: "set" }] }) }],
		},
		guard,
	);
	expect(snapshotOwnership(store.getState())?.write).toBe((before?.write ?? 0) + 1);
	expect(snapshotOwnership(store.getState())?.epoch).toBe((before?.epoch ?? 0) + 1);
	expect(written.stage).toBe("prepared");
	const fresh = fixture();
	let entered = false;
	fresh.store.subscribe(() => {
		if (entered) return;
		entered = true;
		const tx = fresh.store.beginTransaction();
		tx.mutate((state) => ({ ...state, data: { secret: "draft" } }));
		fresh.store.commitTransaction(tx);
	});
	expect(executeSubmitPreparation(fresh.context, fresh.guard).stage).toBe("rejected");
});

test.each(["data", "uiState", "fieldPolicy", "stage"] as const)(
	"changed-and-reverted %s in a prepared transaction still advances the semantic epoch",
	(key) => {
		const { store } = fixture();
		const before = snapshotOwnership(store.getState());
		const tx = store.beginTransaction();
		tx.mutate((state) => ({
			...state,
			...(key === "stage"
				? { meta: { ...state.meta, stage: "edit" } }
				: key === "data"
					? { data: { secret: "changed" } }
					: key === "uiState"
						? { uiState: { open: false } }
						: { fieldPolicy: [] }),
		}));
		tx.mutate((state) => ({
			...state,
			[key === "stage" ? "meta" : key]: key === "stage" ? tx.prevState.meta : tx.prevState[key],
		}));
		commitPreparedSubmit(store, tx, () => {});
		expect(snapshotOwnership(store.getState())?.epoch).toBe((before?.epoch ?? 0) + 1);
	},
);
