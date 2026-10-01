import { expect, it, vi } from "vitest";
import { createKaladaV1Host } from "../kalada-v1-host.js";
import type {
	DataContext,
	FormbarDataStrategyV1,
	LifecycleRequest,
	LifecycleStatus,
	OmissionRequest,
} from "../validators/kalada-data-strategy.js";
import { KALADA_RUNTIME_ARTIFACT } from "../validators/kalada-private-runtime.js";

const identity = { generation: "g1", fingerprint: "host" };
const literal = (value: unknown) => ({
	format: "kalada-program",
	version: 1,
	profile: "kalada-v1",
	expression: { kind: "literal", value },
});
const output = (id: string, format: string, value: unknown) => ({ type: "output", id, format, value: literal(value) });
const policy = {
	...identity,
	widgets: {},
	renderers: {},
	actions: {},
	namespaces: { data: "available" },
	schema: { side: "input", availability: "complete", paths: [] },
	ui: { availability: "complete", paths: [] },
};
const clean: LifecycleStatus = {
	dirty: false,
	touched: false,
	validating: false,
	submitted: false,
	valid: true,
	issues: { schema: [], extension: [] },
};

function host(ports: Partial<FormbarDataStrategyV1> = {}) {
	let revision = {};
	const strategy: FormbarDataStrategyV1 = {
		contract: "formbar-data-strategy-v1",
		identity: () => ({ artifact: KALADA_RUNTIME_ARTIFACT, policyGeneration: "g1", policyFingerprint: "host" }),
		capture: (context) => ({ token: revision, instance: context.instance, read: () => ({ status: "missing" }) }),
		current: () => revision,
		subscribe: () => () => {},
		captureSubmission: (context) => ({ status: "found", instance: context.instance, revision, data: { draft: true } }),
		submitCaptured: vi.fn(() => ({ status: "submitted" })),
		...ports,
	};
	return {
		strategy,
		rotate: () => {
			revision = {};
		},
	};
}

it("projects nested collection, responsive presentation and scalar output without flattening", () => {
	const h = host();
	const definition = {
		version: 1,
		id: "layout",
		root: {
			type: "section",
			id: "start",
			title: "Start",
			presentation: { span: { base: 12, md: 6 } },
			children: [
				{
					type: "tabs",
					id: "pages",
					tabs: [
						{ id: "one", label: "One", children: [output("amount", "currency-usd", 12.5)] },
						{ id: "two", label: "Two", children: [output("ratio", "percent", 0.25)] },
					],
				},
			],
		},
	};
	const runtime = createKaladaV1Host({ definition, policy, identity, strategy: h.strategy });
	const view = runtime.snapshot();
	expect(view.tree.presentation?.span).toEqual({ base: 12, md: 6 });
	expect(view.tree.children?.[0]?.items?.map((item) => item.children[0]?.nodeId)).toEqual(["amount", "ratio"]);
	expect(view.outputs.map(({ format }) => format)).toEqual(["currency-usd", "percent"]);
	runtime.dispose();
});

it("requires lifecycle and omission capabilities at admission; gates invalid submit without fallback", async () => {
	const h = host();
	const root = { type: "group", id: "root-group", children: [output("value", "plain", true)] };
	expect(() =>
		createKaladaV1Host({
			definition: { version: 1, id: "omit", root, submission: { hiddenValues: "omit-inactive" } },
			policy,
			identity,
			strategy: h.strategy,
		}),
	).toThrow("submission.hiddenValues: OMISSION_STRATEGY_REQUIRED");
	const invalid = { ...clean, valid: false, issues: { schema: ["invalid"], extension: ["extension"] } };
	const strategy: FormbarDataStrategyV1 = {
		...h.strategy,
		captureLifecycle: (context) => ({
			instance: context.instance,
			revision: h.strategy.current(context),
			initial: { draft: false },
			form: invalid,
			field: () => ({ status: "missing" }),
		}),
		validateLifecycle: () => ({ status: "denied" }),
		resetLifecycle: () => ({ status: "denied" }),
	};
	const runtime = createKaladaV1Host({ definition: { version: 1, id: "gated", root }, policy, identity, strategy });
	expect(runtime.snapshot().lifecycle?.issues).toEqual(invalid.issues);
	expect(await runtime.submit()).toEqual({ status: "denied" });
	expect(h.strategy.submitCaptured).not.toHaveBeenCalled();
	runtime.dispose();
});

it("submits the host-owned omission candidate without mutating draft or using captured submission", async () => {
	const h = host();
	const submitOmission = vi.fn((_context: DataContext, _request: OmissionRequest & { candidate: unknown }) => ({
		status: "submitted" as const,
	}));
	const strategy: FormbarDataStrategyV1 = {
		...h.strategy,
		captureLifecycle: (context) => ({
			instance: context.instance,
			revision: h.strategy.current(context),
			initial: { draft: true },
			form: clean,
			field: () => ({ status: "found", value: clean }),
		}),
		validateLifecycle: (_context, request) => ({ status: "applied", revision: request.revision }),
		resetLifecycle: (_context, request) => ({ status: "applied", revision: request.revision }),
		captureOmission: (context, request) => ({
			status: "found",
			instance: context.instance,
			revision: request.revision,
			candidate: { outgoing: true },
		}),
		validateOutgoingCandidate: (_context, request, fresh) =>
			fresh() ? { status: "applied", revision: request.revision, proof: {} } : { status: "stale" },
		submitOmission,
	};
	const runtime = createKaladaV1Host({
		definition: {
			version: 1,
			id: "omission",
			root: { type: "group", id: "root-group", children: [output("value", "plain", 1)] },
			submission: { hiddenValues: "omit-inactive" },
		},
		policy,
		identity,
		strategy,
	});
	expect(await runtime.submit()).toEqual({ status: "submitted" });
	expect(submitOmission.mock.calls[0]?.[1]).toMatchObject({ candidate: { outgoing: true }, fields: [] });
	expect(strategy.submitCaptured).not.toHaveBeenCalled();
	expect(runtime.snapshot().data).toEqual({ draft: true });
	runtime.dispose();
});

it("invokes revision-bound validate and reset through the installed lifecycle ports", async () => {
	const h = host();
	const validateLifecycle = vi.fn((_context: DataContext, request: LifecycleRequest) => ({
		status: "applied" as const,
		revision: request.revision,
	}));
	const resetLifecycle = vi.fn((_context: DataContext, request: LifecycleRequest) => ({
		status: "applied" as const,
		revision: request.revision,
	}));
	const strategy: FormbarDataStrategyV1 = {
		...h.strategy,
		captureLifecycle: (context) => ({
			instance: context.instance,
			revision: h.strategy.current(context),
			initial: { draft: false },
			form: clean,
			field: () => ({ status: "missing" }),
		}),
		validateLifecycle,
		resetLifecycle,
	};
	const runtime = createKaladaV1Host({
		definition: {
			version: 1,
			id: "lifecycle-actions",
			root: {
				type: "group",
				id: "controls",
				children: [
					{ type: "action", id: "validate", action: "validate" },
					{ type: "action", id: "reset", action: "reset" },
				],
			},
		},
		policy,
		identity,
		strategy,
	});
	const actions = runtime.snapshot().tree.children;
	expect(await actions?.[0]?.action?.invoke()).toMatchObject({ status: "applied" });
	expect(await actions?.[1]?.action?.invoke()).toMatchObject({ status: "applied" });
	expect(validateLifecycle).toHaveBeenCalledTimes(1);
	expect(resetLifecycle).toHaveBeenCalledTimes(1);
	runtime.dispose();
});
