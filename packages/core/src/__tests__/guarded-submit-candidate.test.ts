import { describe, expect, it } from "vitest";
import type { Middleware } from "../contracts.js";
import { createForm } from "../create-form.js";
import { prepareGuardedSubmitCandidate } from "../guarded-submit-candidate.js";
import type { FormPlugin } from "../plugin-types.js";
import { FormStore } from "../store.js";

function fixture(middleware: Middleware[] = [], plugins: FormPlugin[] = []) {
	const form = createForm({ initialData: { hidden: "secret", included: "Ada" }, initialUiState: { tab: 1 } });
	const store = new FormStore(form.getState());
	form.dispose();
	let revision = 0;
	const controller = new AbortController();
	const context = {
		action: { type: "submit" as const },
		store,
		isSubmit: true,
		submitContext: { requestId: "test", at: "now" },
		options: { middleware },
		plugins,
	};
	const guard = {
		signal: controller.signal,
		expectedRevision: 0,
		revision: () => revision,
		onCommittedMutation: () => {
			revision++;
		},
		isActive: () => true,
	};
	const adapter = () => ({
		data: { included: "Ada" },
		witness: {
			kind: "omission" as const,
			omitted: [[{ kind: "key" as const, key: "hidden" }]],
			protected: [],
			rowAnchors: [],
		},
	});
	return {
		store,
		context,
		guard,
		adapter,
		controller,
		advance: () => {
			revision++;
		},
	};
}

describe("internal guarded B handoff", () => {
	it("runs veto and plugin gates before exactly one owned capture, then candidate-only ordered egress", () => {
		const trace: string[] = [];
		const f = fixture(
			[
				{
					id: "veto",
					beforeSubmit: () => {
						trace.push("veto");
						return { action: "continue" };
					},
				},
			],
			[
				{
					id: "gate",
					beforeSubmit: () => {
						trace.push("plugin");
					},
				},
			],
		);
		const retained = f.store.getState();
		let committed = retained;
		f.context.plugins[0] = {
			id: "gate",
			beforeSubmit: () => {
				trace.push("plugin");
				committed = f.store.getState();
			},
		};
		let captures = 0;
		const result = prepareGuardedSubmitCandidate(
			f.context,
			f.guard,
			(capture) => {
				captures++;
				trace.push("capture");
				expect(capture.data).not.toBe(committed.data);
				expect(capture.uiState).not.toBe(committed.uiState);
				expect(capture.fieldPolicy).not.toBe(committed.fieldPolicy);
				expect(capture.fieldPolicy).toEqual(committed.fieldPolicy);
				return f.adapter();
			},
			[
				(value, context) => {
					trace.push("egress");
					expect(Object.keys(context).sort()).toEqual(["data", "phase", "uiState"]);
					expect(JSON.stringify({ value, context })).not.toContain("secret");
					return { included: "Grace" };
				},
			],
		);
		expect(trace).toEqual(["veto", "plugin", "capture", "egress"]);
		expect(captures).toBe(1);
		expect(result).toMatchObject({ ok: true, candidate: { data: { included: "Grace" } } });
		expect(f.store.getState().data).toBe(committed.data);
		expect(f.store.getState().uiState).toBe(committed.uiState);
		expect(retained.data).toEqual({ hidden: "secret", included: "Ada" });
		expect(Object.isFrozen(retained.data)).toBe(false);
	});

	it("never captures after veto or plugin failure", () => {
		for (const f of [
			fixture([{ id: "veto", beforeSubmit: () => ({ action: "veto", reason: "stop" }) }]),
			fixture(
				[],
				[
					{
						id: "block",
						beforeSubmit: () => [
							{ severity: "error", code: "no", message: "no", source: { origin: "plugin", pluginId: "block" } },
						],
					},
				],
			),
		]) {
			let calls = 0;
			expect(
				prepareGuardedSubmitCandidate(f.context, f.guard, () => {
					calls++;
					return f.adapter();
				}),
			).toMatchObject({ ok: false });
			expect(calls).toBe(0);
		}
	});

	it.each(["revision", "abort", "reset"] as const)("stops subsequent plugin gates on %s", (kind) => {
		const trace: string[] = [];
		const f = fixture();
		f.context.plugins.push(
			{
				id: "first",
				beforeSubmit: () => {
					if (kind === "abort") f.controller.abort();
					else if (kind === "revision") f.advance();
					else {
						const tx = f.store.beginTransaction();
						tx.mutate((s) => ({ ...s, data: { hidden: "changed", included: "Ada" } }));
						f.store.commitTransaction(tx);
					}
				},
			},
			{
				id: "second",
				beforeSubmit: () => {
					trace.push("second");
				},
			},
		);
		expect(prepareGuardedSubmitCandidate(f.context, f.guard, f.adapter)).toEqual({ ok: false, code: "stale" });
		expect(trace).toEqual([]);
	});

	it("rejects deactivation, thrown gates and async gate results without capture", () => {
		const f = fixture();
		let active = true;
		f.guard.isActive = () => active;
		f.context.plugins.push({
			id: "deactivate",
			beforeSubmit: () => {
				active = false;
			},
		});
		let captures = 0;
		const capture = () => {
			captures++;
			return f.adapter();
		};
		expect(prepareGuardedSubmitCandidate(f.context, f.guard, capture)).toEqual({ ok: false, code: "stale" });
		for (const beforeSubmit of [
			() => {
				throw new Error("secret");
			},
			() => Promise.resolve([]),
		]) {
			const g = fixture([], [{ id: "gate", beforeSubmit } as FormPlugin]);
			expect(prepareGuardedSubmitCandidate(g.context, g.guard, capture)).toEqual({ ok: false, code: "vetoed" });
		}
		expect(captures).toBe(0);
	});

	it("rejects reentrancy during adapter or egress and fails closed on final proof", () => {
		const f = fixture();
		expect(
			prepareGuardedSubmitCandidate(f.context, f.guard, (capture) => {
				f.advance();
				return f.adapter();
			}),
		).toEqual({ ok: false, code: "stale" });
		const g = fixture();
		expect(
			prepareGuardedSubmitCandidate(g.context, g.guard, g.adapter, [() => ({ included: "Ada", hidden: "secret" })]),
		).toEqual({ ok: false, code: "invalid_witness" });
		const h = fixture();
		expect(
			prepareGuardedSubmitCandidate(h.context, h.guard, h.adapter, [
				() => {
					h.controller.abort();
					return { included: "Ada" };
				},
			]),
		).toEqual({ ok: false, code: "stale" });
	});

	it("rejects missing proof, alias, unsafe bytes and retained in-place mutation", () => {
		const f = fixture();
		expect(
			prepareGuardedSubmitCandidate(
				f.context,
				f.guard,
				() => ({ data: { included: "Ada" } }) as ReturnType<typeof f.adapter>,
			),
		).toEqual({ ok: false, code: "invalid_witness" });
		const g = fixture();
		expect(prepareGuardedSubmitCandidate(g.context, g.guard, g.adapter, [() => g.store.getState().data])).toEqual({
			ok: false,
			code: "unsafe_candidate",
		});
		const h = fixture();
		expect(prepareGuardedSubmitCandidate(h.context, h.guard, h.adapter, [() => ({ included: Number.NaN })])).toEqual({
			ok: false,
			code: "unsafe_candidate",
		});
		const j = fixture();
		expect(
			prepareGuardedSubmitCandidate(j.context, j.guard, j.adapter, [
				() => {
					(j.store.getState().data as { included: string }).included = "tampered";
					return { included: "Ada" };
				},
			]),
		).toEqual({ ok: false, code: "unsafe_candidate" });
	});
});
