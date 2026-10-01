import { expect, it } from "vitest";
import type {
	FormbarDataStrategyV1,
	LifecycleStatus,
} from "../../../packages/declarative/src/validators/kalada-data-strategy.js";
import { privateLifecycle } from "../../../packages/declarative/src/validators/kalada-private-lifecycle.js";

const clean = (): LifecycleStatus => ({
	dirty: false,
	touched: false,
	validating: false,
	submitted: false,
	valid: true,
	issues: { schema: [], extension: [] },
});

function host() {
	const context = { instance: {}, policyGeneration: "1", policyFingerprint: "p" };
	let revision = {};
	let grant = true;
	let draft = "initial";
	let status: LifecycleStatus = clean();
	let writes = 0;
	const initial = { name: "initial" };
	const strategy: FormbarDataStrategyV1 = {
		contract: "formbar-data-strategy-v1",
		identity: () => ({ artifact: "test", policyGeneration: "1", policyFingerprint: "p" }),
		capture: () => ({ token: revision, read: () => ({ status: "denied" }) }),
		current: () => revision,
		subscribe: () => () => {},
		captureLifecycle: () => ({
			instance: context.instance,
			revision,
			initial,
			form: status,
			field: ({ path }) =>
				path !== "root.name"
					? { status: "missing" }
					: grant
						? { status: "found", value: status }
						: { status: "denied" },
		}),
		resetLifecycle: (_ctx, request) => {
			if (!grant) return { status: "denied" };
			if (request.revision !== revision) return { status: "stale" };
			draft = initial.name;
			status = clean();
			writes++;
			revision = {};
			return { status: "applied", revision };
		},
		validateLifecycle: async (_ctx, request, fresh) => {
			await pending;
			if (!fresh() || !grant || request.revision !== revision) return { status: "stale" };
			status = { ...status, valid: false, issues: { schema: ["required"], extension: ["reserved"] } };
			writes++;
			revision = {};
			return { status: "applied", revision };
		},
	};
	let release = () => {};
	let pending: Promise<void> = Promise.resolve();
	return {
		context,
		strategy,
		get writes() {
			return writes;
		},
		get draft() {
			return draft;
		},
		change() {
			draft = "edited";
			status = { ...clean(), dirty: true, touched: true, validating: true };
			revision = {};
		},
		rotate() {
			revision = {};
		},
		revoke() {
			grant = false;
			revision = {};
		},
		block() {
			pending = new Promise<void>((resolve) => {
				release = resolve;
			});
		},
		release: () => release(),
	};
}

it("reads form and field from one revision; resets baseline and retains issue provenance", async () => {
	const h = host();
	const port = privateLifecycle(h.strategy, h.context, () => true);
	const field = { path: "root.name", scope: { rows: [] } };
	h.change();
	const captured = port.capture();
	expect(captured.ok && captured.value.form).toMatchObject({ dirty: true, touched: true, validating: true });
	expect(port.field(field)).toMatchObject({ ok: true, value: { dirty: true } });
	h.rotate();
	expect(captured.ok && captured.value.field(field)).toEqual({ status: "stale" });
	expect(await port.validate()).toEqual({ ok: true, value: undefined });
	expect(port.field(field)).toMatchObject({
		ok: true,
		value: { valid: false, issues: { schema: ["required"], extension: ["reserved"] } },
	});
	expect(port.reset()).toEqual({ ok: true, value: undefined });
	expect(h.draft).toBe("initial");
	expect(port.capture()).toMatchObject({ ok: true, value: { initial: { name: "initial" }, form: { dirty: false } } });
});

it("fences async validation after a revoked grant or revision change without publishing issues", async () => {
	for (const deny of [false, true]) {
		const h = host();
		const port = privateLifecycle(h.strategy, h.context, () => true);
		h.block();
		const result = port.validate();
		if (deny) h.revoke();
		else h.rotate();
		h.release();
		expect(await result).toEqual({ ok: false, code: "STALE_CAPTURE" });
		expect(h.writes).toBe(0);
		expect(port.field({ path: "root.name", scope: { rows: [] } })).toMatchObject(
			deny ? { ok: false, code: "LIFECYCLE_DENIED" } : { ok: true, value: { valid: true } },
		);
	}
});

it("fails closed when lifecycle capability is missing", async () => {
	const h = host();
	const strategy = { ...h.strategy, captureLifecycle: undefined, resetLifecycle: undefined };
	const port = privateLifecycle(strategy, h.context, () => true);
	expect(port.capture()).toEqual({ ok: false, code: "LIFECYCLE_UNAVAILABLE" });
	expect(port.reset()).toEqual({ ok: false, code: "LIFECYCLE_UNAVAILABLE" });
});

it.each(["denied", "missing", "stale"] as const)("maps host %s capture without reading a frame", (status) => {
	const h = host();
	const port = privateLifecycle({ ...h.strategy, captureLifecycle: () => ({ status }) }, h.context, () => true);
	const code = status === "denied" ? "LIFECYCLE_DENIED" : status === "missing" ? "LIFECYCLE_MISSING" : "STALE_CAPTURE";
	expect(port.capture()).toEqual({ ok: false, code });
	expect(port.reset()).toEqual({ ok: false, code });
});
