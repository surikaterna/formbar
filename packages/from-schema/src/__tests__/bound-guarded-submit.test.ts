import { createForm } from "@formbar/core";
import { originalIssueSource } from "@formbar/core/internal/scoped-sync";
import { boundSubmitStore, prepareGuardedSubmitCandidate } from "@formbar/core/internal/submit-proof";
import { describe, expect, it } from "vitest";
import { validateGuardedSubmitCandidate } from "../../../core/src/guarded-submit-validation.js";
import type { PipelineContext } from "../../../core/src/pipeline.js";
import { publishIssueOnly, publishValidationStatus } from "../../../core/src/store.js";
import type { CandidateEgress } from "../../../core/src/submit-candidate-safety.js";
import { createValidationCoordinator } from "../../../core/src/validation-coordinator.js";
import { certifiedExclusiveBinding } from "../../../declarative/src/certified-binding-evidence.js";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";

function preparedDefinition(certified = false) {
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
			...(certified
				? {
						fieldValidators: [
							{
								fieldId: "secret",
								validate: ({ data }: { data: unknown }) =>
									data && typeof data === "object" && "secret" in data
										? [{ code: "bad", message: "same", severity: "error" as const }]
										: [],
							},
						],
					}
				: {}),
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

function receiptFixture(order: "certified first" | "unowned first" = "certified first") {
	const form = preparedDefinition(true).createForm({
		initialData: { secret: "draft", included: "Ada", protected: "stay" },
		ownedScheduling: true,
	});
	const store = boundSubmitStore(form);
	if (!store) throw Error("missing store");
	const original = form.validate().find((issue) => issue.source.validatorId === "secret");
	if (!original) throw Error("missing original emission");
	const unowned = {
		...original,
		path: { ...original.path, segments: [...original.path.segments] },
		source: { ...original.source },
	};
	expect(originalIssueSource(original)).toBeDefined();
	publishIssueOnly(store, order === "certified first" ? [original, unowned] : [unowned, original]);
	expect(originalIssueSource(original)).toBeDefined();
	expect(certifiedExclusiveBinding(original)).toBe(true);
	const coordinator = createValidationCoordinator({
		validators: [],
		getState: () => store.getState(),
		publishValidationStatus: (paths, validating) => publishValidationStatus(store, paths, validating),
		updateState: (update) => {
			const tx = store.beginTransaction();
			tx.mutate(update);
			store.commitTransaction(tx);
		},
		validatorTimeout: 20,
	});
	const context = {
		action: { type: "submit" as const },
		store,
		isSubmit: true,
		submitContext: { requestId: "receipt", at: "now" },
		options: {},
	};
	const controller = new AbortController();
	const guard = {
		signal: controller.signal,
		expectedRevision: 0,
		revision: () => coordinator.revision(),
		onCommittedMutation: () => {},
	};
	const run = (overrides: Partial<PipelineContext> = {}, transforms: readonly CandidateEgress[] = []) =>
		validateGuardedSubmitCandidate(
			{ ...context, ...overrides },
			guard,
			undefined,
			coordinator,
			"receipt",
			transforms,
			undefined,
			form,
		);
	return { form, store, original, unowned, coordinator, context, guard, controller, run };
}

describe("#331 real bound guarded candidate", () => {
	it.each(["certified first", "unowned first"])("receipts cover only the original hidden issue (%s)", async (order) => {
		const f = receiptFixture(order as "certified first" | "unowned first");
		let validations = 0;
		const validate = f.coordinator.validateCandidate;
		f.coordinator.validateCandidate = (...args) => {
			validations++;
			return validate(...args);
		};
		let captures = 0;
		const capture = f.form.captureState;
		const draft = f.form.getState().data;
		f.form.captureState = () => {
			captures++;
			return capture();
		};
		const result = await f.run({}, [() => ({ included: "Grace", protected: "stay" })]);
		expect(validations).toBe(1);
		expect(result).toMatchObject({ ok: true });
		if (result.ok) {
			expect(result.receipt?.covers(f.original)).toBe(true);
			expect(result.receipt?.covers(f.unowned)).toBe(false);
			expect(result.checked?.candidate.plan?.omitted).toEqual([[{ kind: "key", key: "secret" }]]);
			expect(result.checked?.candidate.data).toEqual({ included: "Grace", protected: "stay" });
		}
		expect(captures).toBe(1);
		expect(f.form.getState().data).toBe(draft);
		f.form.dispose();
	});

	it("rejects a non-owned first publication without recreating the scoped issue", () => {
		const form = preparedDefinition(true).createForm({ initialData: { secret: "draft", protected: "stay" } });
		const store = boundSubmitStore(form);
		if (!store) throw Error("missing store");
		const original = form.validate().find((issue) => issue.source.validatorId === "secret");
		if (!original) throw Error("missing original");
		expect(originalIssueSource(original)).toBeDefined();
		publishIssueOnly(store, [original]);
		expect(originalIssueSource(original)).toBeUndefined();
		form.dispose();
	});

	it("preserves metadata-only issue identity, but never inherits a replacement", async () => {
		const f = receiptFixture();
		publishIssueOnly(f.store, [...f.store.getState().issues]);
		const result = await f.run();
		expect(result.ok && result.receipt?.covers(f.original)).toBe(true);
		const replaced = receiptFixture();
		publishIssueOnly(replaced.store, [replaced.unowned]);
		const after = await replaced.run();
		expect(after.ok && after.receipt).toBeFalsy();
		f.form.dispose();
		replaced.form.dispose();
	});

	it("rejects meaningful equal-value pipeline writes and sync reentry", async () => {
		const f = receiptFixture();
		const written = await f.run({
			plugins: [{ id: "same-value", evaluate: () => ({ writes: [{ path: "secret", value: "draft", mode: "set" }] }) }],
		});
		expect(written.ok && written.receipt).toBeFalsy();
		const competing = receiptFixture();
		const outcome = await competing.run({
			options: {
				middleware: [
					{
						id: "competitor",
						beforeValidate: () => {
							competing.form.validate();
						},
					},
				],
			},
		});
		expect(outcome.ok && outcome.receipt).toBeFalsy();
		f.form.dispose();
		competing.form.dispose();
	});

	it("rejects changed/reverted owned writes and competing async FINAL generation", async () => {
		const stale = receiptFixture();
		stale.form.setValue("secret", "changed");
		stale.form.setValue("secret", "draft");
		const afterWrite = await stale.run();
		expect(afterWrite.ok && afterWrite.receipt).toBeFalsy();
		stale.form.dispose();
		const competing = receiptFixture();
		const result = await competing.run({
			options: {
				middleware: [
					{
						id: "async-competitor",
						beforeValidate: () => {
							void competing.coordinator.validateCandidate({ data: {}, uiState: {} }, competing.coordinator.revision());
						},
					},
				],
			},
		});
		expect(result.ok && result.receipt).toBeFalsy();
		competing.form.dispose();
	});

	it("rechecks original issue identity after FINAL publications and abort", async () => {
		const f = receiptFixture();
		const result = await f.run({
			options: { middleware: [{ id: "replace", afterValidate: () => publishIssueOnly(f.store, [f.unowned]) }] },
		});
		expect(result.ok && result.receipt).toBeFalsy();
		f.form.dispose();
		const aborted = receiptFixture();
		aborted.controller.abort();
		expect((await aborted.run()).ok).toBe(false);
		aborted.form.dispose();
	});
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
