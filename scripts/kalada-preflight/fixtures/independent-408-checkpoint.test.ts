import { describe, expect, it } from "vitest";
import type {
	DataContext,
	FormbarDataStrategyV1,
	LifecycleField,
	OmissionRequest,
} from "../../../packages/declarative/src/validators/kalada-data-strategy.js";
import { privateLifecycle } from "../../../packages/declarative/src/validators/kalada-private-lifecycle.js";
import { privateOmission } from "../../../packages/declarative/src/validators/kalada-private-omission.js";

type Issue = { readonly source: object; readonly owner: object; readonly path: string };
type Session = {
	revision: object;
	rows: { token: object; value: string }[];
	baseline: { items: { secret: string }[]; retained: string };
	draft: { items: { secret: string }[]; retained: string };
	issues: Issue[];
	hidden: boolean;
	published?: unknown;
};

function mapHostState() {
	const instance = {};
	const token = {};
	const other = {};
	const origin = {};
	const session: Session = {
		revision: {},
		rows: [
			{ token, value: "draft" },
			{ token: other, value: "other" },
		],
		baseline: { items: [{ secret: "default" }, { secret: "other" }], retained: "keep" },
		draft: { items: [{ secret: "draft" }, { secret: "other" }], retained: "keep" },
		issues: [{ source: origin, owner: token, path: "items.secret" }],
		hidden: true,
	};
	const sessions = new Map<object, Session>([[instance, session]]);
	const receipts = new WeakMap<
		object,
		{ revision: object; instance: object; bytes: string; issue: Issue; epoch: number; consumed: boolean }
	>();
	const context: DataContext = { instance, policyGeneration: "g", policyFingerprint: "p" };
	const field: LifecycleField = { path: "items.secret", scope: { rows: [{ name: "items", token }] } };
	const observation = { hiddenValues: "omit-inactive" as const, fields: [{ field, visible: false }] };
	return {
		instance,
		token,
		origin,
		session,
		sessions,
		receipts,
		grant: true,
		grantEpoch: 0,
		notifications: 0,
		outgoing: 0,
		context,
		field,
		observation,
		candidateIssue: undefined as Issue | undefined,
		wait: undefined as (() => void) | undefined,
	};
}

type MapHostState = ReturnType<typeof mapHostState>;
const permitted = (s: MapHostState, ctx: DataContext, revision: object) => {
	const current = s.sessions.get(ctx.instance);
	return current === s.session && s.grant && current.revision === revision;
};
const lifecycleRequest = (
	s: MapHostState,
	ctx: DataContext,
	request: { contract: string; instance: object; revision: object },
) =>
	request.contract === "formbar-lifecycle-v1" && request.instance === s.instance && permitted(s, ctx, request.revision);
const originalOnly = (s: MapHostState, issue: Issue | undefined) =>
	issue !== undefined &&
	issue === s.session.issues[0] &&
	s.session.issues.length === 1 &&
	issue.source === s.origin &&
	issue.owner === s.token &&
	issue.path === "items.secret" &&
	s.session.hidden;
const inventory = (s: MapHostState, request: OmissionRequest) =>
	request.contract === "formbar-lifecycle-v1" &&
	request.instance === s.instance &&
	request.revision === s.session.revision &&
	request.hiddenValues === "omit-inactive" &&
	request.fields.length === s.session.rows.length &&
	request.fields.every(
		(entry, index) =>
			entry.field.path === "items.secret" &&
			entry.field.scope.rows.length === 1 &&
			entry.field.scope.rows[0]?.name === "items" &&
			entry.field.scope.rows[0]?.token === s.session.rows[index]?.token &&
			entry.visible === (index === 0 ? !s.session.hidden : true) &&
			entry.submitWhenHidden === undefined,
	);
const candidate = (s: MapHostState) => ({
	items: s.session.rows.map((entry, index) => (index === 0 && s.session.hidden ? {} : { secret: entry.value })),
	retained: s.session.draft.retained,
});
const currentCandidate = (s: MapHostState, bytes: string) =>
	s.session.rows.length === s.session.draft.items.length &&
	s.session.rows.every((entry, index) => entry.value === s.session.draft.items[index]?.secret) &&
	bytes === JSON.stringify(candidate(s));
const status = (s: MapHostState) => ({
	dirty: true,
	touched: false,
	validating: false,
	submitted: false,
	valid: s.session.issues.length === 0,
	issues: { schema: s.session.issues.map((issue) => issue.path), extension: [] },
});

function mapLifecyclePorts(
	s: MapHostState,
): Pick<FormbarDataStrategyV1, "captureLifecycle" | "validateLifecycle" | "resetLifecycle"> {
	const { session } = s;
	return {
		captureLifecycle: (ctx) => {
			const capturedRevision = session.revision;
			const epoch = s.grantEpoch;
			if (!permitted(s, ctx, capturedRevision)) return { status: "denied" };
			return {
				instance: ctx.instance,
				revision: capturedRevision,
				form: status(s),
				initial: session.baseline,
				field: (target) =>
					!permitted(s, ctx, capturedRevision) ||
					epoch !== s.grantEpoch ||
					target.path !== "items.secret" ||
					target.scope.rows.length !== 1 ||
					target.scope.rows[0]?.name !== "items" ||
					!session.rows.some((entry) => entry.token === target.scope.rows[0]?.token)
						? { status: "denied" }
						: { status: "found", value: status(s) },
			};
		},
		validateLifecycle: async (ctx, request, fresh) => {
			const epoch = s.grantEpoch;
			if (!lifecycleRequest(s, ctx, request)) return { status: "stale" };
			await new Promise<void>((resolve) => {
				s.wait = resolve;
			});
			return fresh() && epoch === s.grantEpoch && lifecycleRequest(s, ctx, request)
				? { status: "applied", revision: session.revision }
				: { status: "stale" };
		},
		resetLifecycle: (ctx, request) => {
			if (!lifecycleRequest(s, ctx, request)) return { status: "stale" };
			session.draft = structuredClone(session.baseline);
			session.rows.forEach((entry, index) => {
				entry.value = session.draft.items[index]?.secret ?? "";
			});
			session.issues = [];
			session.revision = {};
			return { status: "applied", revision: session.revision };
		},
	};
}

function mapOmissionPorts(
	s: MapHostState,
): Pick<FormbarDataStrategyV1, "captureOmission" | "validateOutgoingCandidate" | "submitOmission"> {
	const { session, instance } = s;
	return {
		captureOmission: (ctx, request) => {
			if (!permitted(s, ctx, request.revision) || !inventory(s, request)) return { status: "denied" };
			s.candidateIssue = originalOnly(s, session.issues[0]) ? session.issues[0] : undefined;
			return { status: "found", instance, revision: session.revision, candidate: candidate(s) };
		},
		...mapProofPorts(s),
	};
}

function mapProofPorts(s: MapHostState): Pick<FormbarDataStrategyV1, "validateOutgoingCandidate" | "submitOmission"> {
	const { session, instance, receipts } = s;
	return {
		validateOutgoingCandidate: async (ctx, request, fresh) => {
			const epoch = s.grantEpoch;
			if (!lifecycleRequest(s, ctx, request) || !inventory(s, request)) return { status: "stale" };
			await new Promise<void>((resolve) => {
				s.wait = resolve;
			});
			if (!fresh() || epoch !== s.grantEpoch || !permitted(s, ctx, request.revision) || !inventory(s, request))
				return { status: "stale" };
			if (!currentCandidate(s, JSON.stringify(request.candidate))) return { status: "invalid" };
			if (!s.candidateIssue || !originalOnly(s, s.candidateIssue)) return { status: "invalid" };
			const proof = {};
			receipts.set(proof, {
				revision: session.revision,
				instance,
				bytes: JSON.stringify(request.candidate),
				issue: s.candidateIssue,
				epoch,
				consumed: false,
			});
			return { status: "applied", revision: session.revision, proof };
		},
		submitOmission: async (ctx, request, fresh) => {
			const epoch = s.grantEpoch;
			if (!lifecycleRequest(s, ctx, request) || !inventory(s, request)) return { status: "denied" };
			await new Promise<void>((resolve) => {
				s.wait = resolve;
			});
			const receipt = receipts.get(request.proof);
			if (
				!fresh() ||
				!permitted(s, ctx, request.revision) ||
				!inventory(s, request) ||
				!receipt ||
				epoch !== s.grantEpoch ||
				receipt.epoch !== epoch ||
				!originalOnly(s, receipt.issue) ||
				receipt.consumed ||
				receipt.instance !== ctx.instance ||
				receipt.revision !== request.revision ||
				receipt.bytes !== JSON.stringify(request.candidate) ||
				!currentCandidate(s, receipt.bytes)
			)
				return { status: "denied" };
			receipt.consumed = true;
			session.published = request.candidate;
			s.notifications++;
			s.outgoing++;
			return { status: "submitted" };
		},
	};
}

/** Independent topology: per-instance session map, ordered row records and per-proof WeakMap. */
function independentHost() {
	const s = mapHostState();
	const { session, context, field, observation, origin, token } = s;
	const strategy: FormbarDataStrategyV1 = {
		contract: "formbar-data-strategy-v1",
		identity: () => ({ artifact: "map-host", policyGeneration: "g", policyFingerprint: "p" }),
		capture: () => ({ token: session.revision, read: () => ({ status: "denied" }) }),
		current: (ctx) => s.sessions.get(ctx.instance)?.revision ?? {},
		subscribe: () => () => {},
		...mapLifecyclePorts(s),
		...mapOmissionPorts(s),
	};
	return {
		context,
		field,
		observation,
		session,
		strategy,
		get notifications() {
			return s.notifications;
		},
		get outgoing() {
			return s.outgoing;
		},
		setGrant(grant: boolean) {
			s.grant = grant;
			s.grantEpoch++;
		},
		origin,
		token,
		resume() {
			s.wait?.();
			s.wait = undefined;
		},
		reorder() {
			session.rows.reverse();
			session.draft.items.reverse();
		},
		remove() {
			session.rows.splice(0, 1);
		},
	};
}

async function finish(h: ReturnType<typeof independentHost>, work: Promise<unknown>) {
	for (let step = 0; step < 8; step++) {
		h.resume();
		await Promise.resolve();
	}
	return work;
}

describe("#408 independent map/row-tree host", () => {
	it("rejects direct lifecycle identity, contract and revision forgeries and malformed lexical scopes", async () => {
		for (const forgery of [{ instance: {} }, { contract: "forged" as "formbar-lifecycle-v1" }, { revision: {} }]) {
			const h = independentHost();
			const request = {
				contract: "formbar-lifecycle-v1" as const,
				instance: h.context.instance,
				revision: h.session.revision,
				...forgery,
			};
			const before = {
				draft: structuredClone(h.session.draft),
				revision: h.session.revision,
				issues: [...h.session.issues],
			};
			expect(await finish(h, Promise.resolve(h.strategy.validateLifecycle?.(h.context, request, () => true)))).toEqual({
				status: "stale",
			});
			expect(h.strategy.resetLifecycle?.(h.context, request)).toEqual({ status: "stale" });
			expect({ draft: h.session.draft, revision: h.session.revision, issues: h.session.issues }).toEqual(before);
			expect({ notifications: h.notifications, outgoing: h.outgoing }).toEqual({ notifications: 0, outgoing: 0 });
		}
		const h = independentHost();
		const frame = h.strategy.captureLifecycle?.(h.context);
		if (!frame || !("field" in frame)) throw new Error("missing frame");
		for (const rows of [
			[{ name: "wrong", token: h.token }],
			[
				{ name: "outer", token: {} },
				{ name: "items", token: h.token },
			],
			[],
		])
			expect(frame.field({ ...h.field, scope: { rows } })).toEqual({ status: "denied" });
		expect(frame.field(h.field).status).toBe("found");
		expect(h.session.draft.items[0].secret).toBe("draft");
	});
	it("rejects direct omission forgeries at capture, FINAL and commit", async () => {
		for (const forgery of [
			{ instance: {} },
			{ contract: "forged" as "formbar-lifecycle-v1" },
			{ revision: {} },
			{ hiddenValues: "include" as "omit-inactive" },
			{ fields: [] },
			{
				fields: [{ field: { path: "items.secret", scope: { rows: [{ name: "items", token: {} }] } }, visible: false }],
			},
		]) {
			const h = independentHost();
			const full = {
				...h.observation,
				fields: [
					h.observation.fields[0],
					{
						field: { ...h.field, scope: { rows: [{ name: "items", token: h.session.rows[1].token }] } },
						visible: true,
					},
				],
			};
			const request = {
				contract: "formbar-lifecycle-v1" as const,
				instance: h.context.instance,
				revision: h.session.revision,
				...full,
				candidate: { items: [{}, { secret: "other" }], retained: "keep" },
			};
			expect(h.strategy.captureOmission?.(h.context, request)?.status).toBe("found");
			const receipt = await finish(
				h,
				Promise.resolve(h.strategy.validateOutgoingCandidate?.(h.context, request, () => true)),
			);
			if (!receipt || receipt.status !== "applied") throw new Error("missing proof");
			const malformed = { ...request, ...forgery };
			const before = {
				draft: structuredClone(h.session.draft),
				revision: h.session.revision,
				issues: [...h.session.issues],
			};
			expect(h.strategy.captureOmission?.(h.context, malformed)).toEqual({ status: "denied" });
			expect(
				await finish(h, Promise.resolve(h.strategy.validateOutgoingCandidate?.(h.context, malformed, () => true))),
			).toEqual({ status: "stale" });
			expect(
				await finish(
					h,
					Promise.resolve(h.strategy.submitOmission?.(h.context, { ...malformed, proof: receipt.proof }, () => true)),
				),
			).toEqual({ status: "denied" });
			expect({ draft: h.session.draft, revision: h.session.revision, issues: h.session.issues }).toEqual(before);
			expect({ published: h.session.published, notifications: h.notifications, outgoing: h.outgoing }).toEqual({
				published: undefined,
				notifications: 0,
				outgoing: 0,
			});
		}
	});
	it("fences lifecycle callbacks across revoke/regrant without a revision change", async () => {
		const h = independentHost();
		const lifecycle = privateLifecycle(h.strategy, h.context, () => true);
		const captured = lifecycle.capture();
		const pending = lifecycle.validate();
		h.setGrant(false);
		h.setGrant(true);
		expect(captured.ok && captured.value.field(h.field)).toEqual({ status: "denied" });
		expect(await finish(h, pending)).toEqual({ ok: false, code: "STALE_CAPTURE" });
	});
	it("rejects stale draft and row values after receipt without a revision bump, then accepts fresh proof", async () => {
		for (const mutate of ["draft", "row"] as const) {
			const h = independentHost();
			const full = {
				...h.observation,
				fields: [
					h.observation.fields[0],
					{
						field: { path: "items.secret", scope: { rows: [{ name: "items", token: h.session.rows[1].token }] } },
						visible: true,
					},
				],
			};
			const request = {
				contract: "formbar-lifecycle-v1" as const,
				instance: h.context.instance,
				revision: h.session.revision,
				...full,
				candidate: { items: [{}, { secret: "other" }], retained: "keep" },
			};
			expect(h.strategy.captureOmission?.(h.context, request)?.status).toBe("found");
			const receipt = await finish(
				h,
				Promise.resolve(h.strategy.validateOutgoingCandidate?.(h.context, request, () => true)),
			);
			if (!receipt || receipt.status !== "applied") throw new Error("missing proof");
			const pending = Promise.resolve(
				h.strategy.submitOmission?.(h.context, { ...request, proof: receipt.proof }, () => true),
			);
			if (mutate === "draft") h.session.draft.items[1].secret = "changed";
			else h.session.rows[1].value = "changed";
			expect(await finish(h, pending)).toEqual({ status: "denied" });
			expect({ published: h.session.published, notifications: h.notifications, outgoing: h.outgoing }).toEqual({
				published: undefined,
				notifications: 0,
				outgoing: 0,
			});
			h.session.draft.items[1].secret = "changed";
			h.session.rows[1].value = "changed";
			const submit = privateOmission(h.strategy, h.context, () => true).submit(full, h.session.revision);
			expect(await finish(h, submit)).toEqual({ ok: true, status: "submitted" });
			expect(h.session.published).toEqual({ items: [{}, { secret: "changed" }], retained: "keep" });
		}
	});
	it("requires complete lexical inventory after reorder, and never uses position as authority", async () => {
		const h = independentHost();
		const submit = privateOmission(h.strategy, h.context, () => true);
		expect(await finish(h, submit.submit(h.observation, h.session.revision))).toEqual({
			ok: false,
			code: "OMISSION_DENIED",
		});
		const full = {
			...h.observation,
			fields: [
				h.observation.fields[0],
				{
					field: { path: "items.secret", scope: { rows: [{ name: "items", token: h.session.rows[1].token }] } },
					visible: true,
				},
			],
		};
		expect(await finish(h, submit.submit(full, h.session.revision))).toEqual({ ok: true, status: "submitted" });
		expect(h.session.published).toEqual({ items: [{}, { secret: "other" }], retained: "keep" });
		expect(h.session.draft.items[0].secret).toBe("draft");
		const request = {
			contract: "formbar-lifecycle-v1" as const,
			instance: h.context.instance,
			revision: h.session.revision,
			...full,
			candidate: { items: [{}, { secret: "other" }], retained: "keep" },
		};
		const validated = await finish(
			h,
			Promise.resolve(h.strategy.validateOutgoingCandidate?.(h.context, request, () => true)),
		);
		expect(validated).toMatchObject({ status: "applied" });
		if (!validated || typeof validated !== "object" || !("proof" in validated)) throw new Error("missing receipt");
		const replay = { ...request, proof: validated.proof as object };
		expect(await finish(h, Promise.resolve(h.strategy.submitOmission?.(h.context, replay, () => true)))).toEqual({
			status: "submitted",
		});
		expect(await finish(h, Promise.resolve(h.strategy.submitOmission?.(h.context, replay, () => true)))).toEqual({
			status: "denied",
		});
		h.reorder();
		expect(await submit.submit(full, h.session.revision)).toEqual({ ok: false, code: "OMISSION_DENIED" });
		h.remove();
		expect(await submit.submit(full, h.session.revision)).toEqual({ ok: false, code: "OMISSION_DENIED" });
	});
	it("rejects independent same-path and ancestor origins; fences async validation and reset", async () => {
		const h = independentHost();
		const full = {
			...h.observation,
			fields: [
				h.observation.fields[0],
				{
					field: { path: "items.secret", scope: { rows: [{ name: "items", token: h.session.rows[1].token }] } },
					visible: true,
				},
			],
		};
		const submit = privateOmission(h.strategy, h.context, () => true);
		h.session.issues.push({ source: {}, owner: h.token, path: "items.secret" });
		expect(await finish(h, submit.submit(full, h.session.revision))).toEqual({ ok: false, code: "OMISSION_INVALID" });
		h.session.issues.pop();
		h.session.issues.push({ source: {}, owner: h.token, path: "items" });
		expect(await finish(h, submit.submit(full, h.session.revision))).toEqual({ ok: false, code: "OMISSION_INVALID" });
		const lifecycle = privateLifecycle(h.strategy, h.context, () => true);
		const captured = lifecycle.capture();
		const wrong = privateLifecycle(h.strategy, { ...h.context, instance: {} }, () => true);
		expect(wrong.capture()).toEqual({ ok: false, code: "LIFECYCLE_DENIED" });
		expect(wrong.field(h.field)).toEqual({ ok: false, code: "LIFECYCLE_DENIED" });
		const pending = lifecycle.validate();
		h.setGrant(false);
		expect(lifecycle.capture()).toEqual({ ok: false, code: "LIFECYCLE_DENIED" });
		expect(lifecycle.field(h.field)).toEqual({ ok: false, code: "LIFECYCLE_DENIED" });
		expect(captured.ok && captured.value.field(h.field)).toEqual({ status: "denied" });
		h.resume();
		expect(await finish(h, pending)).toEqual({ ok: false, code: "STALE_CAPTURE" });
		h.setGrant(true);
		const abort = lifecycle.validate();
		const prior = h.session.revision;
		expect(lifecycle.reset()).toEqual({ ok: true, value: undefined });
		h.resume();
		expect(await finish(h, abort)).toEqual({ ok: false, code: "STALE_CAPTURE" });
		expect(h.session.revision).not.toBe(prior);
		expect(h.session.draft).toEqual(h.session.baseline);
		expect(captured.ok && captured.value.field(h.field)).toEqual({ status: "stale" });
	});
	it("rejects an equal-shaped new issue after validation without mutating the session", async () => {
		const h = independentHost();
		const full = {
			...h.observation,
			fields: [
				h.observation.fields[0],
				{
					field: { path: "items.secret", scope: { rows: [{ name: "items", token: h.session.rows[1].token }] } },
					visible: true,
				},
			],
		};
		const request = {
			contract: "formbar-lifecycle-v1" as const,
			instance: h.context.instance,
			revision: h.session.revision,
			...full,
			candidate: { items: [{}, { secret: "other" }], retained: "keep" },
		};
		expect(h.strategy.captureOmission?.(h.context, request)?.status).toBe("found");
		const validated = await finish(
			h,
			Promise.resolve(h.strategy.validateOutgoingCandidate?.(h.context, request, () => true)),
		);
		if (!validated || validated.status !== "applied") throw new Error("missing proof");
		const before = {
			draft: structuredClone(h.session.draft),
			revision: h.session.revision,
			published: h.session.published,
		};
		h.session.issues.push({ source: h.origin, owner: h.token, path: "items.secret" });
		const submit = () =>
			finish(
				h,
				Promise.resolve(h.strategy.submitOmission?.(h.context, { ...request, proof: validated.proof }, () => true)),
			);
		expect(await submit()).toEqual({ status: "denied" });
		expect({ draft: h.session.draft, revision: h.session.revision, published: h.session.published }).toEqual(before);
		h.session.issues.shift();
		expect(await submit()).toEqual({ status: "denied" });
	});
	it("rejects a pre-rotation receipt after revoke and regrant without a revision change", async () => {
		const h = independentHost();
		const full = {
			...h.observation,
			fields: [
				h.observation.fields[0],
				{
					field: { path: "items.secret", scope: { rows: [{ name: "items", token: h.session.rows[1].token }] } },
					visible: true,
				},
			],
		};
		const request = {
			contract: "formbar-lifecycle-v1" as const,
			instance: h.context.instance,
			revision: h.session.revision,
			...full,
			candidate: { items: [{}, { secret: "other" }], retained: "keep" },
		};
		expect(h.strategy.captureOmission?.(h.context, request)?.status).toBe("found");
		const validated = await finish(
			h,
			Promise.resolve(h.strategy.validateOutgoingCandidate?.(h.context, request, () => true)),
		);
		if (!validated || validated.status !== "applied") throw new Error("missing proof");
		const before = { draft: structuredClone(h.session.draft), revision: h.session.revision };
		h.setGrant(false);
		h.setGrant(true);
		const stale = h.strategy.submitOmission?.(h.context, { ...request, proof: validated.proof }, () => true);
		expect(await finish(h, Promise.resolve(stale))).toEqual({ status: "denied" });
		expect({ draft: h.session.draft, revision: h.session.revision }).toEqual(before);
		expect({ published: h.session.published, notifications: h.notifications, outgoing: h.outgoing }).toEqual({
			published: undefined,
			notifications: 0,
			outgoing: 0,
		});
		expect(
			await finish(h, privateOmission(h.strategy, h.context, () => true).submit(full, h.session.revision)),
		).toEqual({ ok: true, status: "submitted" });
	});
});
