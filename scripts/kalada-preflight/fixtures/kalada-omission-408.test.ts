import { expect, it } from "vitest";
import type {
	FormbarDataStrategyV1,
	OmissionRequest,
} from "../../../packages/declarative/src/validators/kalada-data-strategy.js";
import { privateOmission } from "../../../packages/declarative/src/validators/kalada-private-omission.js";

const owned = [
	{ field: { path: "root.secret", scope: { rows: [] } }, visible: false },
	{ field: { path: "root.kept", scope: { rows: [] } }, visible: false, submitWhenHidden: "include" as const },
];

function host() {
	const context = { instance: {}, policyGeneration: "1", policyFingerprint: "p" };
	let revision = {};
	let allowed = true;
	let valid = true;
	let active = false;
	let commits = 0;
	let draft = { secret: "draft", kept: "keep", unrelated: "survives" };
	const outgoing: unknown[] = [];
	const check = (request: OmissionRequest) => {
		if (!allowed) return "denied" as const;
		if (request.instance !== context.instance || request.revision !== revision) return "stale" as const;
		if (
			request.fields.length !== 2 ||
			request.fields.some(
				({ field, visible }, i) =>
					field.path !== owned[i]?.field.path || field.scope.rows.length !== 0 || visible !== (i === 0 && active),
			)
		)
			return "conflict" as const;
		if (request.fields[1]?.submitWhenHidden !== "include") return "conflict" as const;
		return "found" as const;
	};
	const strategy: FormbarDataStrategyV1 = {
		contract: "formbar-data-strategy-v1",
		identity: () => ({ artifact: "test", policyGeneration: "1", policyFingerprint: "p" }),
		capture: () => ({ token: revision, read: () => ({ status: "denied" }) }),
		current: () => revision,
		subscribe: () => () => {},
		captureOmission: (_ctx, request) => {
			const status = check(request);
			if (status !== "found") return { status };
			const candidate =
				request.hiddenValues === "omit-inactive" && !active
					? { kept: draft.kept, unrelated: draft.unrelated }
					: { ...draft };
			return { status: "found", instance: context.instance, revision, candidate };
		},
		validateOutgoingCandidate: (_ctx, request, fresh) =>
			check(request) === "found" && fresh() && valid
				? { status: "applied", revision, proof: request.candidate as object }
				: { status: "denied" },
		submitOmission: async (_ctx, request, fresh) => {
			await pending;
			const status = check(request);
			if (status !== "found") return { status };
			if (!fresh()) return { status: "stale" };
			if (!valid || request.proof !== request.candidate) return { status: "denied" };
			outgoing.push(request.candidate);
			commits++;
			revision = {};
			return { status: "submitted" };
		},
	};
	let release = () => {};
	let pending: Promise<void> = Promise.resolve();
	return {
		context,
		strategy,
		outgoing,
		get commits() {
			return commits;
		},
		get draft() {
			return draft;
		},
		activate() {
			active = true;
		},
		invalidate() {
			valid = false;
		},
		revoke() {
			allowed = false;
			revision = {};
		},
		rotate() {
			revision = {};
		},
		block() {
			pending = new Promise<void>((resolve) => {
				release = resolve;
			});
		},
		release: () => release(),
		change() {
			draft = { ...draft, secret: "next" };
			revision = {};
		},
	};
}

it("host owns outgoing omission, preserving draft, unrelated values and explicit include", async () => {
	const h = host();
	const port = privateOmission(h.strategy, h.context, () => true);
	expect(await port.submit({ hiddenValues: "omit-inactive", fields: owned }, h.strategy.current(h.context))).toEqual({
		ok: true,
		status: "submitted",
	});
	expect(h.outgoing).toEqual([{ kept: "keep", unrelated: "survives" }]);
	expect(h.draft.secret).toBe("draft");
	h.activate();
	h.change();
	expect(
		await port.submit(
			{ hiddenValues: "omit-inactive", fields: [{ ...owned[0], visible: true }, owned[1]] },
			h.strategy.current(h.context),
		),
	).toEqual({
		ok: true,
		status: "submitted",
	});
	expect(h.outgoing[1]).toEqual({ secret: "next", kept: "keep", unrelated: "survives" });
});

it("denies overlapping or unowned directives and blocked validation with no commit", async () => {
	const h = host();
	const port = privateOmission(h.strategy, h.context, () => true);
	expect(
		await port.submit(
			{
				hiddenValues: "omit-inactive",
				fields: [...owned, { field: { path: "root.secret", scope: { rows: [] } }, visible: false }],
			},
			h.strategy.current(h.context),
		),
	).toEqual({ ok: false, code: "OMISSION_CONFLICT" });
	h.invalidate();
	expect(await port.submit({ hiddenValues: "include", fields: owned }, h.strategy.current(h.context))).toEqual({
		ok: false,
		code: "OMISSION_DENIED",
	});
	expect(h.commits).toBe(0);
});

it("fences async submission on rotation or revocation and requires explicit ports", async () => {
	for (const deny of [false, true]) {
		const h = host();
		const port = privateOmission(h.strategy, h.context, () => true);
		h.block();
		const result = port.submit({ hiddenValues: "omit-inactive", fields: owned }, h.strategy.current(h.context));
		if (deny) h.revoke();
		else h.rotate();
		h.release();
		expect((await result).ok).toBe(false);
		expect(h.commits).toBe(0);
		expect(h.outgoing).toEqual([]);
	}
	const h = host();
	expect(
		await privateOmission({ ...h.strategy, submitOmission: undefined }, h.context, () => true).submit(
			{
				hiddenValues: "include",
				fields: owned,
			},
			h.strategy.current(h.context),
		),
	).toEqual({ ok: false, code: "OMISSION_UNAVAILABLE" });
	expect(
		await privateOmission({ ...h.strategy, validateOutgoingCandidate: undefined }, h.context, () => true).submit(
			{ hiddenValues: "include", fields: owned },
			h.strategy.current(h.context),
		),
	).toEqual({ ok: false, code: "OMISSION_UNAVAILABLE" });
});

it("rejects a late final validator after reset/disposal without submitting", async () => {
	for (const revoke of [false, true]) {
		const h = host();
		let release = () => {};
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		let live = true;
		const strategy: FormbarDataStrategyV1 = {
			...h.strategy,
			validateOutgoingCandidate: async (_context, request) => {
				await pending;
				return { status: "applied", revision: request.revision, proof: request.candidate as object };
			},
		};
		const result = privateOmission(strategy, h.context, () => live).submit(
			{ hiddenValues: "omit-inactive", fields: owned },
			h.strategy.current(h.context),
		);
		if (revoke) h.revoke();
		else live = false;
		release();
		expect(await result).toEqual({ ok: false, code: "STALE_CAPTURE" });
		expect(h.outgoing).toEqual([]);
	}
});

it("rejects invalid or oversized host candidates before validation or submission", async () => {
	for (const candidate of [{ bad: undefined }, { text: "x".repeat(16385) }]) {
		const h = host();
		let validations = 0;
		const strategy: FormbarDataStrategyV1 = {
			...h.strategy,
			captureOmission: (_context, request) => ({
				status: "found",
				instance: h.context.instance,
				revision: request.revision,
				candidate: candidate as never,
			}),
			validateOutgoingCandidate: () => {
				validations++;
				return { status: "denied" };
			},
		};
		expect(
			await privateOmission(strategy, h.context, () => true).submit(
				{ hiddenValues: "omit-inactive", fields: owned },
				h.strategy.current(h.context),
			),
		).toEqual({ ok: false, code: "STRATEGY_ERROR" });
		expect(validations).toBe(0);
		expect(h.outgoing).toEqual([]);
		expect(h.commits).toBe(0);
	}
});

it("rejects wrong revision or unvalidated proof without invoking submit", async () => {
	for (const mismatch of ["revision", "proof"] as const) {
		const h = host();
		let submits = 0;
		const strategy: FormbarDataStrategyV1 = {
			...h.strategy,
			validateOutgoingCandidate: (_context, request) => ({
				status: "applied",
				revision: mismatch === "revision" ? {} : request.revision,
				proof: mismatch === "proof" ? (null as never) : {},
			}),
			submitOmission: () => {
				submits++;
				return { status: "denied" };
			},
		};
		const result = await privateOmission(strategy, h.context, () => true).submit(
			{ hiddenValues: "omit-inactive", fields: owned },
			h.strategy.current(h.context),
		);
		expect(result.ok).toBe(false);
		expect(submits).toBe(0);
		expect(h.outgoing).toEqual([]);
	}
});

it("reports invalid FINAL distinctly and rejects malformed lexical row identities before host capture", async () => {
	const h = host();
	const strategy: FormbarDataStrategyV1 = { ...h.strategy, validateOutgoingCandidate: () => ({ status: "invalid" }) };
	expect(
		await privateOmission(strategy, h.context, () => true).submit(
			{ hiddenValues: "omit-inactive", fields: owned },
			strategy.current(h.context),
		),
	).toEqual({ ok: false, code: "OMISSION_INVALID" });
	let captures = 0;
	const checked: FormbarDataStrategyV1 = {
		...h.strategy,
		captureOmission: () => {
			captures++;
			return { status: "denied" };
		},
	};
	expect(
		await privateOmission(checked, h.context, () => true).submit(
			{
				hiddenValues: "include",
				fields: [
					{
						field: { path: "root.name", scope: { rows: [{ name: "outer", token: null as never }] } },
						visible: true,
					},
				],
			},
			checked.current(h.context),
		),
	).toEqual({ ok: false, code: "STRATEGY_ERROR" });
	expect(captures).toBe(0);
});
