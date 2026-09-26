import { createForm } from "@formbar/core";
import { boundSubmitStore, prepareGuardedSubmitCandidate } from "@formbar/core/internal/submit-proof";
import { describe, expect, it } from "vitest";
import { validateGuardedSubmitCandidate } from "../../../core/src/guarded-submit-validation.js";
import { createValidationCoordinator } from "../../../core/src/validation-coordinator.js";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";

function preparedDefinition() {
	return createSchemaForm(
		{},
		{
			provider: jsonSchemaProvider(),
			side: "input",
			definition: {
				version: 1,
				id: "bound",
				submission: { hiddenValues: "omit-inactive" },
				root: {
					type: "group",
					id: "root",
					children: [
						{
							type: "field",
							id: "secret",
							widget: "text",
							binding: { namespace: "data", segments: ["secret"] },
							visible: { kind: "literal", value: false },
						},
						{ type: "field", id: "protected", widget: "text", binding: { namespace: "data", segments: ["protected"] } },
					],
				},
			},
		},
	);
}

function fixture(deferred = false) {
	const prepared = preparedDefinition();
	const initialData = { secret: "draft", included: "Ada", protected: "stay" };
	const form = deferred ? prepared.createDeferredForm({ initialData }).form : prepared.createForm({ initialData });
	const store = boundSubmitStore(form);
	if (!store) throw Error("missing core store");
	const controller = new AbortController();
	const context = {
		action: { type: "submit" as const },
		store,
		isSubmit: true,
		submitContext: { requestId: "attempt", at: "now" },
		options: {},
		plugins: [],
	};
	let revision = 0;
	const guard = {
		signal: controller.signal,
		expectedRevision: 0,
		revision: () => revision,
		onCommittedMutation: () => {
			revision++;
		},
		isActive: () => true,
	};
	const run = (transforms: ((value: unknown) => unknown)[] = [], bound = form, adapter?: () => never) =>
		prepareGuardedSubmitCandidate(context, guard, adapter, transforms, bound);
	return { form, store, run, context, guard, revision: () => revision };
}

describe("#331 real bound guarded candidate", () => {
	it.each([false, true])("owns final bytes and checked typed plan from %s prepared form", (deferred) => {
		const f = fixture(deferred);
		let captures = 0;
		const captureState = f.form.captureState;
		f.form.captureState = () => {
			captures++;
			return captureState();
		};
		const draft = f.form.getState().data;
		let egress = 0;
		const result = f.run([
			() => {
				egress++;
				return { included: "Grace", protected: "stay" };
			},
		]);
		expect(f.revision()).toBe(0);
		expect(captures).toBe(1);
		expect(egress).toBe(1);
		expect(result).toMatchObject({
			ok: true,
			candidate: {
				data: { included: "Grace", protected: "stay" },
				plan: { kind: "omission", omitted: [[{ kind: "key", key: "secret" }]] },
			},
		});
		if (result.ok) {
			expect(result.capture?.state).toBe(f.form.getState());
			expect(Object.isFrozen(result.candidate.plan)).toBe(true);
			expect(Object.isFrozen(result.candidate.data)).toBe(true);
		}
		expect(f.form.getState().data).toEqual(draft);
		expect(Object.isFrozen(draft)).toBe(false);
		f.form.dispose();
	});

	it("fails closed on reintroduction, protected edit, unbound form, caller proof and stale capture", () => {
		const f = fixture();
		expect(f.run([() => ({ included: "Ada", protected: "stay", secret: "draft" })])).toMatchObject({ ok: false });
		expect(f.run([() => ({ included: "Ada", protected: "changed" })])).toMatchObject({ ok: false });
		const unbound = createForm({ initialData: f.form.getState().data });
		expect(f.run([], unbound)).toMatchObject({ ok: false });
		expect(
			f.run([], f.form, () => {
				throw Error("untrusted");
			}),
		).toEqual({ ok: false, code: "invalid_witness" });
		const original = f.form.captureState;
		f.form.captureState = () => ({ ...original(), state: { ...f.form.getState() } });
		expect(f.run()).toEqual({ ok: false, code: "stale" });
		unbound.dispose();
		f.form.dispose();
	});

	it("threads the same capture through FINAL validation and returns only checked candidate bytes", async () => {
		const f = fixture();
		let captures = 0;
		const original = f.form.captureState;
		f.form.captureState = () => {
			captures++;
			return original();
		};
		const coordinator = createValidationCoordinator({
			validators: [],
			getState: () => f.store.getState(),
			updateState: (update) => {
				const tx = f.store.beginTransaction();
				tx.mutate(update);
				f.store.commitTransaction(tx);
			},
			validatorTimeout: 20,
		});
		const result = await validateGuardedSubmitCandidate(
			f.context,
			f.guard,
			undefined,
			coordinator,
			"bound-attempt",
			[() => ({ included: "Grace", protected: "stay" })],
			undefined,
			f.form,
		);
		expect(result).toMatchObject({
			ok: true,
			checked: { candidate: { data: { included: "Grace", protected: "stay" } } },
		});
		expect(captures).toBe(1);
		f.form.dispose();
	});

	it("binds generated definitions but refuses a no-omission witness", () => {
		const generated = createSchemaForm(
			{ type: "object", properties: { included: { type: "string" } } },
			{ provider: jsonSchemaProvider(), side: "input", generation: {} },
		);
		const form = generated.createForm({ initialData: { included: "Ada" } });
		const store = boundSubmitStore(form);
		if (!store) throw Error("missing core store");
		const guard = {
			signal: new AbortController().signal,
			expectedRevision: 0,
			revision: () => 0,
			onCommittedMutation: () => {},
		};
		const result = prepareGuardedSubmitCandidate(
			{
				action: { type: "submit" },
				store,
				isSubmit: true,
				submitContext: { requestId: "generated", at: "now" },
				options: {},
			},
			guard,
			undefined,
			[],
			form,
		);
		expect(result).toMatchObject({ ok: false });
		form.dispose();
	});
});
