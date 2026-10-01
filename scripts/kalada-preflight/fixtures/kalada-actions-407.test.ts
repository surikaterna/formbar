import { expect, it } from "vitest";
import type {
	ArrayActionHost407,
	ArrayRequest407,
} from "../../../packages/declarative/src/validators/kalada-action-contract-407.js";
import type { FormbarDataStrategyV1 } from "../../../packages/declarative/src/validators/kalada-data-strategy.js";
import {
	type ActionDeclaration407,
	installPrivateAction407,
} from "../../../packages/declarative/src/validators/kalada-private-actions-407.js";

function fixture() {
	const context = { instance: {}, policyGeneration: "v1", policyFingerprint: "p" };
	let revision = {};
	let granted = true;
	let reads = 0;
	let evaluated = 0;
	const listeners = new Set<() => void>();
	const strategy: FormbarDataStrategyV1 = {
		contract: "formbar-data-strategy-v1",
		identity: () => ({ artifact: "test", policyGeneration: "v1", policyFingerprint: "p" }),
		capture: () => ({ token: revision, instance: context.instance, read: () => ({ status: "denied" }) }),
		current: () => revision,
		subscribe: (_context, invalidate) => {
			listeners.add(invalidate);
			return () => {
				listeners.delete(invalidate);
			};
		},
		captureSubmission: () => ({ status: "found", revision, instance: context.instance, data: { name: "current" } }),
		submitCaptured: (_context, request, fresh) => {
			if (!fresh() || !granted || request.revision !== revision) return { status: "stale" };
			reads++;
			return { status: "submitted" };
		},
	};
	const row = {
		token: {},
		writeRevision: {},
		scope: { rows: [{ name: "items", token: {} }] },
		order: 0,
		formRevision: revision,
	};
	const frame = {
		revision: () => revision,
		evaluate: (path: string) => {
			evaluated++;
			return { ok: true as const, path, value: { name: "new" } };
		},
		readTarget: () => ({ ok: false as const, path: "root", code: "unused" }),
		enumerateRows: () => ({ ok: false as const, path: "root", code: "unused" }),
	};
	const base = { context, strategy, frame, scope: { rows: [] }, live: () => true, allowed: () => granted };
	return {
		base,
		row,
		get reads() {
			return reads;
		},
		get evaluated() {
			return evaluated;
		},
		get subscribers() {
			return listeners.size;
		},
		invalidate: () => {
			for (const listener of listeners) listener();
		},
		rotate: () => {
			revision = {};
		},
		revoke: () => {
			granted = false;
		},
	};
}

function arrayHost(h: ReturnType<typeof fixture>, adversarial = false) {
	const rows = [h.row.token, {}, {}];
	let writes = 0;
	const host: ArrayActionHost407 = {
		mutateArray(_context, request: ArrayRequest407) {
			if (adversarial || !h.base.allowed()) return { status: "denied" };
			if (request.revision !== h.base.strategy.current(h.base.context)) return { status: "stale" };
			if (request.target.namespace !== "data" || request.target.path[0] !== "items") return { status: "denied" };
			if (request.row && !rows.includes(request.row.token)) return { status: "missing" };
			if (request.destination && !rows.includes(request.destination.token)) return { status: "missing" };
			if (request.operation === "array.append" && rows.length >= (request.maxItems ?? 1024))
				return { status: "denied" };
			if (request.operation === "array.remove" && rows.length <= (request.minItems ?? 0)) return { status: "denied" };
			if (request.operation === "array.remove" && request.row) rows.splice(rows.indexOf(request.row.token), 1);
			else if (request.operation === "array.append") rows.push({});
			// Reordering changes only positions; stable tokens remain host-owned.
			else rows.reverse();
			writes++;
			return { status: "applied" };
		},
	};
	return {
		host,
		rows,
		get writes() {
			return writes;
		},
	};
}

const target = { namespace: "data" as const, path: ["items"] };
const declaration = (action: string, extra: Partial<ActionDeclaration407> = {}): ActionDeclaration407 => ({
	path: "root.children[0]",
	action,
	...extra,
});

it("admits without evaluation; checks payload at invocation and array identity/bounds atomically at host", async () => {
	const h = fixture();
	const a = arrayHost(h);
	const bound = installPrivateAction407({
		...h.base,
		arrayHost: a.host,
		declaration: declaration("array.append", { target, payload: true, maxItems: 4 }),
	});
	expect(h.evaluated).toBe(0);
	expect(await bound.invoke()).toMatchObject({ status: "applied" });
	expect(h.evaluated).toBe(1);
	expect(await bound.invoke()).toMatchObject({ status: "denied" });
	const move = installPrivateAction407({
		...h.base,
		arrayHost: a.host,
		row: h.row,
		declaration: declaration("array.move", { target, payload: true }),
	});
	expect(await move.invoke({ ...h.row, token: a.rows[1] })).toMatchObject({ status: "applied" });
	expect(a.rows).toContain(h.row.token);
	const insert = installPrivateAction407({
		...h.base,
		arrayHost: a.host,
		declaration: declaration("array.insert", { target, payload: true }),
	});
	expect(await insert.invoke({ ...h.row, token: a.rows[0] })).toMatchObject({ status: "applied" });
	const swap = installPrivateAction407({
		...h.base,
		arrayHost: a.host,
		row: h.row,
		declaration: declaration("array.swap", { target, payload: true }),
	});
	expect(await swap.invoke({ ...h.row, token: a.rows[0] })).toMatchObject({ status: "applied" });
	const remove = installPrivateAction407({
		...h.base,
		arrayHost: a.host,
		row: h.row,
		declaration: declaration("array.remove", { target, minItems: 4 }),
	});
	expect(await remove.invoke()).toMatchObject({ status: "denied" });
	a.rows.splice(a.rows.indexOf(h.row.token), 1);
	expect(await move.invoke({ ...h.row, token: a.rows[0] })).toMatchObject({ status: "missing" });
	expect(a.writes).toBe(4);
	h.rotate();
	expect(await bound.invoke()).toMatchObject({ status: "stale" });
});

it("denies malformed payload, missing capabilities, revoked grants and adverse host without mutation", async () => {
	const h = fixture();
	const a = arrayHost(h, true);
	const malformed = installPrivateAction407({
		...h.base,
		arrayHost: a.host,
		frame: {
			...h.base.frame,
			evaluate: () => ({ ok: true as const, path: "root.children[0].payload", value: (() => {}) as never }),
		},
		declaration: declaration("array.append", { target, payload: true }),
	});
	expect(await malformed.invoke()).toMatchObject({ status: "invalid", path: "root.children[0].payload" });
	expect(
		await installPrivateAction407({
			...h.base,
			arrayHost: a.host,
			declaration: declaration("array.append", { target, payload: true }),
		}).invoke(),
	).toMatchObject({ status: "denied" });
	expect(await installPrivateAction407({ ...h.base, declaration: declaration("reset") }).invoke()).toMatchObject({
		status: "unsupported",
	});
	h.revoke();
	expect(await installPrivateAction407({ ...h.base, declaration: declaration("submit") }).invoke()).toMatchObject({
		status: "denied",
	});
	expect(a.writes).toBe(0);
});

it("bounds queue, replaces/aborts pending effects, disposes queued callbacks, and submits only once", async () => {
	const h = fixture();
	let release = () => {};
	let effects = 0;
	const block = new Promise<void>((resolve) => {
		release = resolve;
	});
	const handler = async ({ fresh }: { fresh: () => boolean }) => {
		await block;
		if (fresh()) effects++;
		return { status: "applied" as const };
	};
	const queue = installPrivateAction407({
		...h.base,
		declaration: declaration("save", { concurrency: "queue" }),
		handlers: { save: handler },
	});
	const first = queue.invoke();
	const pending = Array.from({ length: 16 }, () => queue.invoke());
	expect(await queue.invoke()).toMatchObject({ status: "queue-full" });
	expect(h.subscribers).toBe(1);
	queue.dispose();
	expect(h.subscribers).toBe(0);
	release();
	await first;
	expect((await Promise.all(pending)).every((item) => item.status === "stale")).toBe(true);
	expect(effects).toBe(0);
	const replace = installPrivateAction407({
		...h.base,
		declaration: declaration("submit", { concurrency: "replace" }),
	});
	expect(await replace.invoke()).toMatchObject({ status: "submitted" });
	expect(await replace.invoke()).toMatchObject({ status: "dropped" });
	expect(h.reads).toBe(1);
});

it("replacement and revision changes fence late trusted effects and submit commits", async () => {
	const h = fixture();
	let release = () => {};
	const block = new Promise<void>((resolve) => {
		release = resolve;
	});
	let effects = 0;
	const action = installPrivateAction407({
		...h.base,
		declaration: declaration("save", { concurrency: "replace" }),
		handlers: {
			save: async ({ fresh }) => {
				await block;
				if (fresh()) effects++;
				return { status: "applied" };
			},
		},
	});
	const old = action.invoke();
	const newest = action.invoke();
	h.rotate();
	h.invalidate();
	release();
	expect(await old).toMatchObject({ status: "replaced" });
	expect(await newest).toMatchObject({ status: "stale" });
	expect(effects).toBe(0);
	expect(h.reads).toBe(0);
});

it("delegates validation/reset to revision-bound lifecycle and exposes current issues/submit state", async () => {
	const h = fixture();
	let revision = h.base.strategy.current(h.base.context);
	let status = {
		dirty: true,
		touched: true,
		validating: false,
		valid: false,
		submitted: false,
		issues: { schema: ["required"], extension: ["reserved"] },
	};
	const strategy: FormbarDataStrategyV1 = {
		...h.base.strategy,
		current: () => revision,
		captureLifecycle: () => ({
			instance: h.base.context.instance,
			revision,
			initial: { name: "initial" },
			form: status,
			field: () => ({ status: "found", value: status }),
		}),
		validateLifecycle: (_context, request, fresh) => {
			if (!fresh() || request.revision !== revision) return { status: "stale" };
			status = { ...status, validating: false, issues: { schema: [], extension: [] }, valid: true };
			revision = {};
			return { status: "applied", revision };
		},
		resetLifecycle: (_context, request) => {
			if (request.revision !== revision) return { status: "stale" };
			status = { ...status, dirty: false, touched: false, submitted: false };
			revision = {};
			return { status: "applied", revision };
		},
	};
	const validate = installPrivateAction407({
		...h.base,
		strategy,
		frame: { ...h.base.frame, revision: () => revision },
		declaration: declaration("validate"),
	});
	expect(await validate.invoke()).toMatchObject({ status: "applied" });
	expect(strategy.captureLifecycle?.(h.base.context).form).toMatchObject({
		valid: true,
		issues: { schema: [], extension: [] },
		submitted: false,
	});
	const reset = installPrivateAction407({
		...h.base,
		strategy,
		frame: { ...h.base.frame, revision: () => revision },
		declaration: declaration("reset"),
	});
	expect(await reset.invoke()).toMatchObject({ status: "applied" });
	expect(status).toMatchObject({ dirty: false, touched: false, submitted: false });
});
