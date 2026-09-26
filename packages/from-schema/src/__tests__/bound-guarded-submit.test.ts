import { createForm } from "@formbar/core";
import { originalIssueSource } from "@formbar/core/internal/scoped-sync";
import { boundSubmitStore, prepareGuardedSubmitCandidate } from "@formbar/core/internal/submit-proof";
import { describe, expect, it } from "vitest";
import { renderableIssues } from "../../../core/src/attempt-issues.js";
import { validateGuardedSubmitCandidate } from "../../../core/src/guarded-submit-validation.js";
import type { PipelineContext } from "../../../core/src/pipeline.js";
import { boundAttemptCanSubmit } from "../../../core/src/retained-issue-eligibility.js";
import { runScopedSync } from "../../../core/src/scoped-sync.js";
import type { ValidationIssue } from "../../../core/src/state.js";
import { publishIssueOnly, publishValidationStatus } from "../../../core/src/store.js";
import type { CandidateEgress } from "../../../core/src/submit-candidate-safety.js";
import { createValidationCoordinator } from "../../../core/src/validation-coordinator.js";
import { certifiedExclusiveBinding } from "../../../declarative/src/certified-binding-evidence.js";
import { createSchemaForm, jsonSchemaProvider } from "../index.js";

function preparedDefinition(
	certified = false,
	conditional = false,
	schema: object = {},
	hiddenValues: "omit-inactive" | "include" = "omit-inactive",
) {
	return createSchemaForm(schema, {
		provider: jsonSchemaProvider(),
		side: "input",
		definition: {
			version: 1,
			id: "bound",
			submission: { hiddenValues },
			root: {
				type: "group",
				id: "root",
				children: [
					{
						type: "field",
						id: "secret",
						widget: "text",
						binding: { namespace: "data", segments: ["secret"] },
						visible: conditional
							? { kind: "ref", ref: { namespace: "data", segments: ["show"] } }
							: { kind: "literal", value: false },
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
	});
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

function receiptFixture(
	order: "certified first" | "unowned first" = "certified first",
	prepared = preparedDefinition(true),
	initialData = { secret: "draft", included: "Ada", protected: "stay" },
	exclusive = true,
) {
	const form = prepared.createForm({
		initialData,
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
	expect(certifiedExclusiveBinding(original)).toBe(exclusive);
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
	it("never exempts hidden draft errors under the authored include override", async () => {
		const f = receiptFixture(
			"certified first",
			preparedDefinition(true, true, {}, "include"),
			{ secret: "draft", included: "Ada", protected: "stay", show: false },
			false,
		);
		publishIssueOnly(f.store, [f.original]);
		expect(f.store.getState().issues.some((issue) => issue.code === "bad")).toBe(true);
		const result = await f.run();
		expect(result).toMatchObject({ ok: false, code: "validation_failed" });
		if (!result.ok && result.code === "validation_failed")
			expect(result.fieldIssues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "bad" })]));
		expect(f.form.getState().data.secret).toBe("draft");
		f.form.dispose();
	});

	it("gates real conditionally hidden invalid values and checks Ajv if/then on the omitted FINAL bytes", async () => {
		const schema = {
			type: "object",
			properties: { flag: { type: "boolean" }, secret: { type: "string" } },
			if: { properties: { flag: { const: true } } },
			then: { required: ["secret"] },
		};
		const prepared = preparedDefinition(true, true, schema);
		for (const flag of [false, true]) {
			const f = receiptFixture("certified first", prepared, {
				secret: "draft",
				included: "Ada",
				protected: "stay",
				show: false,
				flag,
			});
			publishIssueOnly(f.store, [f.original]);
			const result = await f.run({ options: { validators: prepared.validators } });
			expect(f.form.getState().data.secret).toBe("draft");
			if (flag) {
				expect(result).toMatchObject({ ok: false, code: "validation_failed" });
				if (!result.ok && result.code === "validation_failed")
					expect(result.fieldIssues.some((issue) => issue.path.segments.includes("secret"))).toBe(true);
				expect(renderableIssues(f.store.getState()).some((issue) => issue.path.segments.includes("secret"))).toBe(true);
			} else {
				expect(result.ok).toBe(true);
				if (result.ok) {
					expect(result.checked?.candidate.data).toEqual({ included: "Ada", protected: "stay", show: false, flag });
					expect(result.receipt?.covers(f.original)).toBe(true);
				}
			}
			f.form.dispose();
		}
	});

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
		expect(result).toMatchObject({ ok: false, code: "validation_failed" });
		if (!result.ok && result.code === "validation_failed") expect(result.fieldIssues).toEqual([f.unowned]);
		expect(f.store.getState().attemptValidation?.status).toBe("failed");
		expect(boundAttemptCanSubmit(f.store.getState(), f.coordinator.revision(), undefined)).toBe(false);
		expect(renderableIssues(f.store.getState())).toContain(f.original);
		expect(renderableIssues(f.store.getState())).toContainEqual(f.unowned);
		expect(captures).toBe(1);
		expect(f.form.getState().data).toBe(draft);
		f.form.dispose();
	});

	it("permits only the original hidden error after every FINAL validator succeeds", async () => {
		const f = receiptFixture();
		publishIssueOnly(f.store, [f.original]);
		const result = await f.run({}, [() => ({ included: "Grace", protected: "stay" })]);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.receipt?.covers(f.original)).toBe(true);
			expect(boundAttemptCanSubmit(f.store.getState(), result.checked?.revision ?? -1, result.receipt)).toBe(true);
			expect(renderableIssues(f.store.getState())).toContain(f.original);
		}
		f.form.dispose();
	});

	it.each([
		"standard-schema",
		"function-validator",
		"json-schema-adapter",
		"async-validator",
		"rule",
		"middleware",
		"submit",
	] as const)("blocks independent %s errors at the same omitted path", async (origin) => {
		const f = receiptFixture();
		const independent: ValidationIssue = { ...f.unowned, source: { origin, validatorId: "same" } };
		publishIssueOnly(f.store, [f.original, independent]);
		const result = await f.run();
		expect(result).toMatchObject({ ok: false, code: "validation_failed" });
		if (!result.ok && result.code === "validation_failed") expect(result.fieldIssues).toEqual([independent]);
		expect(renderableIssues(f.store.getState())).toContainEqual(independent);
		f.form.dispose();
	});

	it("blocks root/ancestor issues and accepts warning-only retained diagnostics", async () => {
		const f = receiptFixture();
		const root: ValidationIssue = { ...f.unowned, path: { namespace: "data", segments: [] } };
		publishIssueOnly(f.store, [f.original, root]);
		const result = await f.run();
		expect(result.ok && boundAttemptCanSubmit(f.store.getState(), result.checked?.revision ?? -1, result.receipt)).toBe(
			false,
		);
		f.form.dispose();
		const warned = receiptFixture();
		publishIssueOnly(warned.store, [{ ...warned.unowned, severity: "warning" }]);
		const warningResult = await warned.run();
		expect(
			warningResult.ok &&
				boundAttemptCanSubmit(warned.store.getState(), warningResult.checked?.revision ?? -1, warningResult.receipt),
		).toBe(true);
		warned.form.dispose();
	});

	it("never accepts a caller-shaped receipt, a changed state or a failed FINAL candidate", async () => {
		const f = receiptFixture();
		publishIssueOnly(f.store, [f.original]);
		const result = await f.run();
		expect(result.ok).toBe(true);
		if (result.ok) {
			const state = f.store.getState();
			const revision = result.checked?.revision ?? -1;
			expect(boundAttemptCanSubmit(state, revision, { covers: () => true })).toBe(false);
			expect(boundAttemptCanSubmit({ ...state }, revision, result.receipt)).toBe(false);
			expect(boundAttemptCanSubmit(state, revision + 1, result.receipt)).toBe(false);
		}
		f.form.dispose();
		const failed = receiptFixture();
		publishIssueOnly(failed.store, [failed.original]);
		const invalid = await failed.run({
			options: {
				validators: [() => [{ ...failed.unowned, code: "final", message: "final" }]],
			},
		});
		expect(invalid).toMatchObject({ ok: false, code: "validation_failed" });
		if (!invalid.ok && invalid.code === "validation_failed") {
			expect(invalid.fieldIssues.map((issue) => issue.code)).toContain("final");
			expect(renderableIssues(failed.store.getState()).map((issue) => issue.code)).toContain("final");
		}
		expect(boundAttemptCanSubmit(failed.store.getState(), failed.coordinator.revision(), undefined)).toBe(false);
		failed.form.dispose();
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
		expect(result).toMatchObject({ ok: false, code: "validation_failed" });
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

	it.each(["scoped sync", "foreground"])(
		"rejects a competing %s generation in beforeSubmit without issue publication",
		async (lane) => {
			const f = receiptFixture();
			let captures = 0;
			const capture = f.form.captureState;
			f.form.captureState = () => {
				captures++;
				return capture();
			};
			const draft = f.form.getState().data;
			let invalidated = false;
			let competingCaptures = 0;
			const result = await f.run({
				options: {
					middleware: [
						{
							id: "competing-preparation",
							beforeSubmit: () => {
								const before = captures;
								if (lane === "scoped sync") runScopedSync(f.form, f.form.getState().meta.stage);
								else
									void f.coordinator
										.validateCandidate({ data: draft, uiState: f.form.getState().uiState }, f.coordinator.revision())
										.catch(() => {});
								competingCaptures = captures - before;
								invalidated = originalIssueSource(f.original) === undefined;
								return undefined;
							},
						},
					],
				},
			});
			if (lane === "scoped sync") expect(invalidated).toBe(true);
			expect(result.ok && result.receipt?.covers(f.original)).not.toBe(true);
			expect(result.ok && result.receipt?.covers(f.unowned)).not.toBe(true);
			if (lane === "scoped sync") expect(originalIssueSource(f.original)).toBeUndefined();
			expect(f.store.getState().issues).toContain(f.original);
			expect(captures - competingCaptures).toBe(1);
			expect(f.form.getState().data).toBe(draft);
			f.form.dispose();
		},
	);

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

	it("binds generated definitions and checks an unchanged no-omission witness after egress", () => {
		const generated = createSchemaForm(
			{ type: "object", properties: { included: { type: "string" } } },
			{ provider: jsonSchemaProvider(), side: "input", generation: {} },
		);
		const form = generated.createForm({ initialData: { included: "Ada", extra: "before" } });
		const store = boundSubmitStore(form);
		if (!store) throw Error("missing core store");
		const controller = new AbortController();
		const guard = {
			signal: controller.signal,
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
		expect(result).toMatchObject({
			ok: true,
			candidate: { data: { included: "Ada", extra: "before" }, plan: { kind: "no-omission", omitted: [] } },
		});
		const edited = prepareGuardedSubmitCandidate(
			{
				action: { type: "submit" },
				store,
				isSubmit: true,
				submitContext: { requestId: "edit", at: "now" },
				options: {},
			},
			guard,
			undefined,
			[() => ({ included: "Ada", extra: "after" })],
			form,
		);
		expect(edited).toMatchObject({ ok: true, candidate: { data: { included: "Ada", extra: "after" } } });
		const context = {
			action: { type: "submit" as const },
			store,
			isSubmit: true,
			submitContext: { requestId: "negative", at: "now" },
			options: {},
		};
		expect(
			prepareGuardedSubmitCandidate(
				context,
				guard,
				undefined,
				[() => ({ included: "changed", extra: "before" })],
				form,
			),
		).toMatchObject({ ok: false, code: "invalid_witness" });
		expect(prepareGuardedSubmitCandidate(context, guard, undefined, [() => ({ extra: "before" })], form)).toMatchObject(
			{ ok: false, code: "invalid_witness" },
		);
		controller.abort();
		expect(prepareGuardedSubmitCandidate(context, guard, undefined, [], form)).toMatchObject({ ok: false });
		expect(form.getState().data).toEqual({ included: "Ada", extra: "before" });
		form.dispose();
	});
});
