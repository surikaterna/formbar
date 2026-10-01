import { expect, it, vi } from "vitest";
import { createKaladaV1Host } from "../../../packages/declarative/src/kalada-v1-host.js";
import type { FormbarDataStrategyV1 } from "../../../packages/declarative/src/validators/kalada-data-strategy.js";
import { KALADA_RUNTIME_ARTIFACT } from "../../../packages/declarative/src/validators/kalada-private-runtime.js";

const identity = { generation: "g1", fingerprint: "host" };
const target = { namespace: "data", segments: ["items"] };
const payload = {
	format: "kalada-program",
	version: 1,
	profile: "kalada-v1",
	expression: { kind: "literal", value: "new" },
};
const policy = {
	...identity,
	widgets: {},
	renderers: {},
	actions: {},
	namespaces: { data: "available" },
	schema: { side: "input", availability: "complete", paths: [{ path: ["items"], kind: "array" }] },
	ui: { availability: "complete", paths: [] },
};

function fixture() {
	let revision = {};
	let allowed = true;
	const mutate = vi.fn(() => ({ status: "applied" as const }));
	const submit = vi.fn(() => ({ status: "submitted" as const }));
	const strategy: FormbarDataStrategyV1 = {
		contract: "formbar-data-strategy-v1",
		identity: () => ({ artifact: KALADA_RUNTIME_ARTIFACT, policyGeneration: "g1", policyFingerprint: "host" }),
		current: () => revision,
		subscribe: () => () => {},
		capture: (context) => ({ instance: context.instance, token: revision, read: () => ({ status: "denied" }) }),
		captureSubmission: (context) => ({ status: "found", instance: context.instance, revision, data: {} }),
		submitCaptured: (_context, request, fresh) =>
			fresh() && allowed && request.revision === revision ? submit() : { status: "denied" },
	};
	const create = (root: unknown, installed: object = {}) =>
		createKaladaV1Host({ definition: { version: 1, id: "actions", root }, policy, identity, strategy, installed });
	return {
		create,
		mutate,
		submit,
		arrayHost: { mutateArray: mutate },
		revoke: () => {
			allowed = false;
		},
		rotate: () => {
			revision = {};
		},
	};
}

it("admits the canonical payload without evaluating at admission; commits only through host array authority", async () => {
	const h = fixture();
	const host = h.create(
		{ type: "action", id: "add", action: "array.append", target, payload },
		{ arrayHost: h.arrayHost },
	);
	const action = host.snapshot().tree.action;
	expect(await action?.invoke()).toMatchObject({ path: "root", status: "applied" });
	expect(h.mutate).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({
			operation: "array.append",
			payload: "new",
			target: expect.objectContaining({ namespace: "data" }),
		}),
	);
	h.rotate();
	expect(await action?.invoke()).toMatchObject({ status: "stale" });
	expect(h.mutate).toHaveBeenCalledTimes(1);
	host.dispose();
});

it("fails closed for missing host, revoked grant, malformed slots and disposed installed actions", async () => {
	const h = fixture();
	const action = { type: "action", id: "send", action: "submit" };
	const host = h.create(action);
	const installed = host.snapshot().tree.action;
	h.revoke();
	expect(await installed?.invoke()).not.toMatchObject({ status: "submitted" });
	expect(h.submit).not.toHaveBeenCalled();
	host.dispose();
	expect(await installed?.invoke()).toMatchObject({ path: "root", status: "stale" });
	const missing = h.create({ type: "action", id: "add", action: "array.append", target, payload });
	expect(await missing.snapshot().tree.action?.invoke()).toMatchObject({ path: "root.target", status: "unsupported" });
	missing.dispose();
	expect(() => h.create({ ...action, payload })).toThrow("root.payload: INVALID_ACTION_PAYLOAD");
});
