import type { JsonValue } from "@formbar/expressions";
import { describe, expect, it } from "vitest";
import type {
	DataContext,
	FormbarDataStrategyV1,
	LifecycleStatus,
	OmissionRequest,
} from "../../../packages/declarative/src/validators/kalada-data-strategy.js";
import { privateLifecycle } from "../../../packages/declarative/src/validators/kalada-private-lifecycle.js";
import { privateOmission } from "../../../packages/declarative/src/validators/kalada-private-omission.js";

const status = (schema: string[] = []): LifecycleStatus => ({
	dirty: true,
	touched: true,
	validating: false,
	submitted: false,
	valid: schema.length === 0,
	issues: { schema, extension: [] },
});
const instance = {};
const context: DataContext = { instance, policyGeneration: "g", policyFingerprint: "p" };
const row = {};
const field = { path: "secret", scope: { rows: [{ name: "items", token: row }] } };
const observation: Pick<OmissionRequest, "hiddenValues" | "fields"> = {
	hiddenValues: "omit-inactive",
	fields: [{ field, visible: false }],
};

type Issue = { id: string; owner: object; path: string };

function hostState(kind: "immutable" | "transactional") {
	return {
		kind,
		revision: {} as object,
		allowed: true,
		grantEpoch: 0,
		owned: row as object,
		hidden: true,
		draft: { secret: "draft", retained: "yes" },
		initial: { secret: "default", retained: "yes" },
		originalIssue: { id: "original", owner: row, path: "secret" } as Issue,
		issues: [] as Issue[],
		pending: undefined as (() => void) | undefined,
		proof: undefined as object | undefined,
		candidateIssue: undefined as Issue | undefined,
		receipts: new WeakMap<
			object,
			{ instance: object; issue: Issue; revision: object; bytes: string; epoch: number; used: boolean }
		>(),
		published: undefined as unknown,
		notifications: 0,
		outgoing: 0,
		badCandidate: false,
	};
}

type HostState = ReturnType<typeof hostState>;
const granted = (s: HostState, ctx: DataContext, rev: object) =>
	ctx.instance === instance && s.allowed && s.revision === rev;
const issuesAllowOmission = (s: HostState, issue: Issue | undefined) =>
	issue !== undefined &&
	s.issues.length === 1 &&
	s.issues[0] === issue &&
	issue === s.originalIssue &&
	issue.owner === s.owned &&
	issue.path === "secret" &&
	s.hidden;
const observed = (s: HostState, request: OmissionRequest) =>
	request.contract === "formbar-lifecycle-v1" &&
	request.instance === instance &&
	request.hiddenValues === "omit-inactive" &&
	request.fields.length === 1 &&
	request.fields[0]?.field.path === "secret" &&
	request.fields[0].field.scope.rows.length === 1 &&
	request.fields[0].field.scope.rows[0]?.name === "items" &&
	request.fields[0].field.scope.rows[0]?.token === s.owned &&
	request.fields[0].visible === !s.hidden &&
	request.fields[0].submitWhenHidden === undefined;

function lifecyclePorts(
	s: HostState,
): Pick<FormbarDataStrategyV1, "captureLifecycle" | "validateLifecycle" | "resetLifecycle"> {
	return {
		captureLifecycle: (ctx) => {
			const capturedRevision = s.revision;
			const epoch = s.grantEpoch;
			if (!granted(s, ctx, capturedRevision)) return { status: "denied" };
			return {
				instance,
				revision: capturedRevision,
				form: status(s.issues.map((issue) => issue.id)),
				initial: s.initial,
				field: (requested) =>
					!granted(s, ctx, capturedRevision) ||
					epoch !== s.grantEpoch ||
					requested.path !== "secret" ||
					requested.scope.rows.length !== 1 ||
					requested.scope.rows[0]?.name !== "items" ||
					requested.scope.rows[0]?.token !== s.owned
						? { status: "denied" }
						: { status: "found", value: status(s.issues.map((issue) => issue.id)) },
			};
		},
		validateLifecycle: async (ctx, request, fresh) => {
			const epoch = s.grantEpoch;
			if (!lifecycleRequest(s, ctx, request)) return { status: "stale" };
			if (s.kind === "transactional")
				await new Promise<void>((resolve) => {
					s.pending = resolve;
				});
			if (!fresh() || epoch !== s.grantEpoch || !lifecycleRequest(s, ctx, request)) return { status: "stale" };
			return { status: "applied", revision: s.revision };
		},
		resetLifecycle: (ctx, request) => {
			if (!lifecycleRequest(s, ctx, request)) return { status: "stale" };
			s.draft = { ...s.initial };
			s.issues = [];
			s.revision = {};
			return { status: "applied", revision: s.revision };
		},
	};
}

const lifecycleRequest = (
	s: HostState,
	ctx: DataContext,
	request: { contract: string; instance: object; revision: object },
) => request.contract === "formbar-lifecycle-v1" && request.instance === instance && granted(s, ctx, request.revision);

async function transactionalPause(s: HostState) {
	if (s.kind === "transactional")
		await new Promise<void>((resolve) => {
			s.pending = resolve;
		});
}

function omissionPorts(
	s: HostState,
): Pick<FormbarDataStrategyV1, "captureOmission" | "validateOutgoingCandidate" | "submitOmission"> {
	return {
		captureOmission: (ctx, request) => {
			if (!granted(s, ctx, request.revision) || !observed(s, request)) return { status: "denied" };
			s.candidateIssue = issuesAllowOmission(s, s.originalIssue) ? s.originalIssue : undefined;
			return {
				status: "found",
				instance,
				revision: s.revision,
				candidate: s.badCandidate ? (new Date() as never) : s.hidden ? { retained: s.draft.retained } : { ...s.draft },
			};
		},
		validateOutgoingCandidate: (ctx, request, fresh) => validateCandidate(s, ctx, request, fresh),
		submitOmission: (ctx, request, fresh) => submitCandidate(s, ctx, request, fresh),
	};
}

async function validateCandidate(
	s: HostState,
	ctx: DataContext,
	request: OmissionRequest & { readonly candidate: JsonValue },
	fresh: () => boolean,
) {
	const epoch = s.grantEpoch;
	if (!lifecycleRequest(s, ctx, request) || !observed(s, request)) return { status: "stale" } as const;
	await transactionalPause(s);
	if (!fresh() || epoch !== s.grantEpoch || !lifecycleRequest(s, ctx, request) || !observed(s, request))
		return { status: "stale" } as const;
	if (JSON.stringify(request.candidate) !== JSON.stringify({ retained: s.draft.retained }))
		return { status: "invalid" } as const;
	if (!s.candidateIssue || !issuesAllowOmission(s, s.candidateIssue)) return { status: "invalid" } as const;
	s.proof = {};
	s.receipts.set(s.proof, {
		instance: ctx.instance,
		issue: s.candidateIssue,
		revision: s.revision,
		bytes: JSON.stringify(request.candidate),
		epoch,
		used: false,
	});
	return { status: "applied", revision: s.revision, proof: s.proof } as const;
}

async function submitCandidate(
	s: HostState,
	ctx: DataContext,
	request: OmissionRequest & { readonly candidate: JsonValue; readonly proof: object },
	fresh: () => boolean,
) {
	const epoch = s.grantEpoch;
	if (!lifecycleRequest(s, ctx, request) || !observed(s, request)) return { status: "denied" } as const;
	await transactionalPause(s);
	const receipt = s.receipts.get(request.proof);
	if (
		!fresh() ||
		!lifecycleRequest(s, ctx, request) ||
		!observed(s, request) ||
		!receipt ||
		epoch !== s.grantEpoch ||
		receipt.epoch !== epoch ||
		receipt.instance !== ctx.instance ||
		receipt.used ||
		receipt.revision !== request.revision ||
		receipt.bytes !== JSON.stringify(request.candidate) ||
		!issuesAllowOmission(s, receipt.issue) ||
		JSON.stringify(request.candidate) !== JSON.stringify({ retained: s.draft.retained })
	)
		return { status: "denied" } as const;
	receipt.used = true;
	s.published = request.candidate;
	s.notifications++;
	s.outgoing++;
	return { status: "submitted" } as const;
}

function hostControls(s: HostState) {
	return {
		get draft() {
			return s.draft;
		},
		get published() {
			return s.published;
		},
		get revision() {
			return s.revision;
		},
		get proof() {
			return s.proof;
		},
		get notifications() {
			return s.notifications;
		},
		get outgoing() {
			return s.outgoing;
		},
		advance() {
			s.revision = {};
		},
		revoke() {
			s.allowed = false;
			s.grantEpoch++;
		},
		regrant() {
			s.allowed = true;
			s.grantEpoch++;
		},
		reorder() {
			return s.owned;
		},
		replaceRow() {
			s.owned = {};
		},
		restoreRow() {
			s.owned = row;
		},
		show() {
			s.hidden = false;
		},
		badCandidate() {
			s.badCandidate = true;
		},
		addIssue(id: string, path = "secret") {
			s.issues.push({ id, path, owner: row });
		},
		replaceOriginal() {
			s.issues = [{ ...s.originalIssue }];
		},
		resume() {
			s.pending?.();
			s.pending = undefined;
		},
	};
}

/** Two independent host implementations; neither treats observations as authority. */
function host(kind: "immutable" | "transactional") {
	const s = hostState(kind);
	s.issues = [s.originalIssue];
	const strategy: FormbarDataStrategyV1 = {
		contract: "formbar-data-strategy-v1",
		identity: () => ({ artifact: "test", policyGeneration: "g", policyFingerprint: "p" }),
		capture: () => ({ token: s.revision, read: () => ({ status: "denied" }) }),
		current: () => s.revision,
		subscribe: () => () => {},
		...lifecyclePorts(s),
		...omissionPorts(s),
	};
	return Object.assign(hostControls(s), { strategy });
}

async function settle(h: ReturnType<typeof host>, work: Promise<unknown>, steps: number) {
	for (let i = 0; i < steps; i++) {
		h.resume();
		await Promise.resolve();
	}
	return work;
}

describe.each(["immutable", "transactional"] as const)("#408 %s host", (kind) => {
	it("rejects malformed lifecycle requests and lexical field scopes without mutation", async () => {
		for (const forgery of [{ instance: {} }, { contract: "forged" as "formbar-lifecycle-v1" }, { revision: {} }]) {
			const h = host(kind);
			const request = { contract: "formbar-lifecycle-v1" as const, instance, revision: h.revision, ...forgery };
			const before = { draft: structuredClone(h.draft), revision: h.revision };
			expect(await settle(h, Promise.resolve(h.strategy.validateLifecycle?.(context, request, () => true)), 2)).toEqual(
				{ status: "stale" },
			);
			expect(h.strategy.resetLifecycle?.(context, request)).toEqual({ status: "stale" });
			expect({ draft: h.draft, revision: h.revision, notifications: h.notifications }).toEqual({
				...before,
				notifications: 0,
			});
			const captured = h.strategy.captureLifecycle?.(context);
			expect(captured && "form" in captured && captured.form.issues.schema).toEqual(["original"]);
		}
		const h = host(kind);
		const frame = h.strategy.captureLifecycle?.(context);
		if (!frame || !("field" in frame)) throw new Error("missing lifecycle frame");
		for (const rows of [
			[{ name: "wrong", token: row }],
			[
				{ name: "items", token: row },
				{ name: "extra", token: {} },
			],
			[
				{ name: "outer", token: {} },
				{ name: "items", token: row },
			],
			[],
		])
			expect(frame.field({ ...field, scope: { rows } })).toEqual({ status: "denied" });
		expect(frame.field(field).status).toBe("found");
		expect(h.draft.secret).toBe("draft");
		expect(h.notifications).toBe(0);
	});
	it("checks contract, instance, revision, inventory, mode and proof at every omission port", async () => {
		for (const forgery of [
			{ contract: "forged" as "formbar-lifecycle-v1" },
			{ instance: {} },
			{ revision: {} },
			{ hiddenValues: "include" as "omit-inactive" },
			{ fields: [{ field: { ...field, scope: { rows: [{ name: "wrong", token: row }] } }, visible: false }] },
		]) {
			const h = host(kind);
			const request = {
				contract: "formbar-lifecycle-v1" as const,
				instance,
				revision: h.revision,
				...observation,
				candidate: { retained: "yes" },
			};
			expect(h.strategy.captureOmission?.(context, request)?.status).toBe("found");
			const receipt = await settle(
				h,
				Promise.resolve(h.strategy.validateOutgoingCandidate?.(context, request, () => true)),
				2,
			);
			if (!receipt || receipt.status !== "applied") throw new Error("missing proof");
			const malformed = { ...request, ...forgery };
			const before = { draft: structuredClone(h.draft), revision: h.revision };
			expect(h.strategy.captureOmission?.(context, malformed)).toEqual({ status: "denied" });
			expect(
				await settle(h, Promise.resolve(h.strategy.validateOutgoingCandidate?.(context, malformed, () => true)), 2),
			).toEqual({ status: "stale" });
			expect(
				await settle(
					h,
					Promise.resolve(h.strategy.submitOmission?.(context, { ...malformed, proof: receipt.proof }, () => true)),
					2,
				),
			).toEqual({ status: "denied" });
			expect({
				draft: h.draft,
				revision: h.revision,
				published: h.published,
				notifications: h.notifications,
				outgoing: h.outgoing,
			}).toEqual({ ...before, published: undefined, notifications: 0, outgoing: 0 });
		}
	});
	it("fences captured field callbacks and pending lifecycle validation across regrant", async () => {
		const h = host(kind);
		const lifecycle = privateLifecycle(h.strategy, context, () => true);
		const captured = lifecycle.capture();
		const pending = lifecycle.validate();
		h.revoke();
		h.regrant();
		expect(captured.ok && captured.value.field(field)).toEqual({ status: "denied" });
		expect(await settle(h, pending, 2)).toEqual(
			kind === "transactional" ? { ok: false, code: "STALE_CAPTURE" } : { ok: true, value: undefined },
		);
	});
	it("rejects a changed current candidate after proof issuance and permits a new proof", async () => {
		const h = host(kind);
		const request = {
			contract: "formbar-lifecycle-v1" as const,
			instance,
			revision: h.revision,
			...observation,
			candidate: { retained: "yes" },
		};
		expect(h.strategy.captureOmission?.(context, request)?.status).toBe("found");
		const receipt = await settle(
			h,
			Promise.resolve(h.strategy.validateOutgoingCandidate?.(context, request, () => true)),
			2,
		);
		if (!receipt || receipt.status !== "applied") throw new Error("missing proof");
		const pending = Promise.resolve(
			h.strategy.submitOmission?.(context, { ...request, proof: receipt.proof }, () => true),
		);
		h.draft.retained = "changed";
		expect(await settle(h, pending, 2)).toEqual({ status: "denied" });
		expect({ published: h.published, notifications: h.notifications, outgoing: h.outgoing }).toEqual({
			published: undefined,
			notifications: 0,
			outgoing: 0,
		});
		const fresh = privateOmission(h.strategy, context, () => true).submit(observation, h.revision);
		expect(await settle(h, fresh, 6)).toEqual({ ok: true, status: "submitted" });
		expect(h.published).toEqual({ retained: "changed" });
	});
	it("rejects a forged request instance or row scope independently of the context", async () => {
		const h = host(kind);
		const request = {
			contract: "formbar-lifecycle-v1" as const,
			instance: {},
			revision: h.revision,
			...observation,
			candidate: { retained: "yes" },
		};
		expect(h.strategy.captureOmission?.(context, request)).toEqual({ status: "denied" });
		const wrongScope = {
			...request,
			instance,
			fields: [{ field: { ...field, scope: { rows: [{ name: "wrong", token: row }] } }, visible: false }],
		};
		expect(h.strategy.captureOmission?.(context, wrongScope)).toEqual({ status: "denied" });
	});
	it("binds snapshots, initialized reset and sync/async validation to the revision", async () => {
		const h = host(kind);
		const lifecycle = privateLifecycle(h.strategy, context, () => true);
		const captured = lifecycle.capture();
		expect(captured.ok && captured.value.initial).toEqual({ secret: "default", retained: "yes" });
		expect(lifecycle.field(field).ok).toBe(true);
		const wrong = privateLifecycle(h.strategy, { ...context, instance: {} }, () => true);
		expect(wrong.capture()).toEqual({ ok: false, code: "LIFECYCLE_DENIED" });
		expect(wrong.field(field)).toEqual({ ok: false, code: "LIFECYCLE_DENIED" });
		expect(lifecycle.field({ ...field, scope: { rows: [{ name: "items", token: {} }] } })).toEqual({
			ok: false,
			code: "LIFECYCLE_DENIED",
		});
		const waiting = lifecycle.validate();
		expect(await settle(h, waiting, 2)).toEqual({ ok: true, value: undefined });
		expect(lifecycle.reset()).toEqual({ ok: true, value: undefined });
		expect(h.draft.secret).toBe("default");
		expect(captured.ok && captured.value.field(field)).toEqual({ status: "stale" });
		const race = lifecycle.validate();
		h.advance();
		h.resume();
		expect(await settle(h, race, 2)).toEqual({ ok: false, code: "STALE_CAPTURE" });
	});
	it("checks provenance, same-path/ancestor issues, visibility and candidate type", async () => {
		const h = host(kind);
		const submit = privateOmission(h.strategy, context, () => true);
		let result = submit.submit(observation, h.revision);
		expect(await settle(h, result, 6)).toEqual({ ok: true, status: "submitted" });
		expect(h.published).toEqual({ retained: "yes" });
		expect(h.draft).toEqual({ secret: "draft", retained: "yes" });
		const replay = h.strategy.submitOmission?.(
			context,
			{
				contract: "formbar-lifecycle-v1",
				instance,
				revision: h.revision,
				...observation,
				candidate: { retained: "yes" },
				proof: h.proof ?? {},
			},
			() => true,
		);
		expect(await settle(h, Promise.resolve(replay), 2)).toEqual({ status: "denied" });
		h.addIssue("independent");
		result = submit.submit(observation, h.revision);
		expect(await settle(h, result, 6)).toEqual({ ok: false, code: "OMISSION_INVALID" });
		h.addIssue("ancestor", "items");
		result = submit.submit(observation, h.revision);
		expect(await settle(h, result, 6)).toEqual({ ok: false, code: "OMISSION_INVALID" });
		h.show();
		expect(await submit.submit(observation, h.revision)).toEqual({ ok: false, code: "OMISSION_DENIED" });
		h.badCandidate();
		expect(await submit.submit({ ...observation, fields: [{ field, visible: true }] }, h.revision)).toEqual({
			ok: false,
			code: "STRATEGY_ERROR",
		});
	});
	it("rejects wrong instance, replaced row, revocation and async abort without positional fallback", async () => {
		const h = host(kind);
		const wrong = privateOmission(h.strategy, { ...context, instance: {} }, () => true);
		expect(await wrong.submit(observation, h.revision)).toEqual({ ok: false, code: "OMISSION_DENIED" });
		const submit = privateOmission(h.strategy, context, () => true);
		h.reorder();
		let work = submit.submit(observation, h.revision);
		expect(await settle(h, work, 6)).toEqual({ ok: true, status: "submitted" });
		h.replaceRow();
		expect(await submit.submit(observation, h.revision)).toEqual({ ok: false, code: "OMISSION_DENIED" });
		h.restoreRow();
		let live = true;
		const aborted = privateOmission(h.strategy, context, () => live);
		work = aborted.submit(observation, h.revision);
		live = false;
		expect(await settle(h, work, 6)).toEqual({ ok: false, code: "STALE_CAPTURE" });
		const validation = privateLifecycle(h.strategy, context, () => true).validate();
		const captured = privateLifecycle(h.strategy, context, () => true).capture();
		h.revoke();
		expect(privateLifecycle(h.strategy, context, () => true).capture()).toEqual({
			ok: false,
			code: "LIFECYCLE_DENIED",
		});
		expect(privateLifecycle(h.strategy, context, () => true).field(field)).toEqual({
			ok: false,
			code: "LIFECYCLE_DENIED",
		});
		expect(captured.ok && captured.value.field(field)).toEqual({ status: "denied" });
		expect(await settle(h, validation, 2)).toEqual(
			kind === "transactional" ? { ok: false, code: "STALE_CAPTURE" } : { ok: true, value: undefined },
		);
		expect(await submit.submit(observation, h.revision)).toEqual({ ok: false, code: "OMISSION_DENIED" });
	});
	it("binds FINAL receipt to the original issue, not its shape", async () => {
		const h = host(kind);
		const request = {
			contract: "formbar-lifecycle-v1" as const,
			instance,
			revision: h.revision,
			...observation,
			candidate: { retained: "yes" },
		};
		const proof = await settle(
			h,
			Promise.resolve(h.strategy.validateOutgoingCandidate?.(context, request, () => true)),
			2,
		);
		// Validation without a host candidate is not authority.
		expect(proof).toEqual({ status: "invalid" });
		const capture = h.strategy.captureOmission?.(context, request);
		expect(capture?.status).toBe("found");
		const validated = await settle(
			h,
			Promise.resolve(h.strategy.validateOutgoingCandidate?.(context, request, () => true)),
			2,
		);
		if (!validated || validated.status !== "applied") throw new Error("missing proof");
		const before = { draft: structuredClone(h.draft), revision: h.revision, published: h.published };
		h.addIssue("original");
		const submit = () =>
			settle(
				h,
				Promise.resolve(h.strategy.submitOmission?.(context, { ...request, proof: validated.proof }, () => true)),
				2,
			);
		expect(await submit()).toEqual({ status: "denied" });
		expect({ draft: h.draft, revision: h.revision, published: h.published }).toEqual(before);
		h.replaceOriginal();
		expect(await submit()).toEqual({ status: "denied" });
	});
	it("invalidates an unconsumed proof across revoke and regrant at the same revision", async () => {
		const h = host(kind);
		const request = {
			contract: "formbar-lifecycle-v1" as const,
			instance,
			revision: h.revision,
			...observation,
			candidate: { retained: "yes" },
		};
		expect(h.strategy.captureOmission?.(context, request)?.status).toBe("found");
		const validated = await settle(
			h,
			Promise.resolve(h.strategy.validateOutgoingCandidate?.(context, request, () => true)),
			2,
		);
		if (!validated || validated.status !== "applied") throw new Error("missing proof");
		const before = { draft: structuredClone(h.draft), revision: h.revision };
		h.revoke();
		h.regrant();
		const stale = h.strategy.submitOmission?.(context, { ...request, proof: validated.proof }, () => true);
		expect(await settle(h, Promise.resolve(stale), 2)).toEqual({ status: "denied" });
		expect({ draft: h.draft, revision: h.revision }).toEqual(before);
		expect({ published: h.published, notifications: h.notifications, outgoing: h.outgoing }).toEqual({
			published: undefined,
			notifications: 0,
			outgoing: 0,
		});
		const fresh = privateOmission(h.strategy, context, () => true).submit(observation, h.revision);
		expect(await settle(h, fresh, 6)).toEqual({ ok: true, status: "submitted" });
	});
});
