import { expect, it } from "vitest";
import type { OmissionRequest } from "../../../packages/declarative/src/validators/kalada-data-strategy.js";
import { privateOmission } from "../../../packages/declarative/src/validators/kalada-private-omission.js";
import { generatedHost } from "./generated-host.js";
import { independentHost } from "./kalada-independent-host-408.js";

function setup(factory: typeof generatedHost | typeof independentHost, origin?: Parameters<typeof generatedHost>[3]) {
	const host = factory("outer", "inner", "root.children[0].children[0]", origin);
	const context = { instance: {}, policyGeneration: "g1", policyFingerprint: "host" };
	const revision = host.strategy.current(context);
	const state = host.instances.get(context.instance);
	if (!state) throw Error("missing draft");
	const parent = state.rows[0];
	const rows = parent?.nested;
	if (!parent || !rows?.[0]) throw Error("missing nested row");
	const request: OmissionRequest = {
		contract: "formbar-lifecycle-v1",
		instance: context.instance,
		revision,
		hiddenValues: "omit-inactive",
		fields: [
			{ field: { path: "root.children[0].children[0]", scope: { rows: [] } }, visible: false },
			{
				field: {
					path: "root.children[1].children[0].children[0].children[0].children[0]",
					scope: {
						rows: [
							{ name: "outer", token: parent.token },
							{ name: "inner", token: rows[0].token },
						],
					},
				},
				visible: true,
			},
		],
	};
	return { host, context, state, request };
}

it.each([generatedHost, independentHost])(
	"trusted host rejects fabricated visibility, missing rows, duplicate and wrong token",
	async (factory) => {
		const { host, context, state, request } = setup(factory);
		const capture = host.strategy.captureOmission;
		expect(capture?.(context, request).status).toBe("found");
		const [name, row] = request.fields;
		if (!name || !row) throw Error("missing inventory");
		for (const fields of [
			[{ ...name, visible: true }, row],
			[name, { ...row, visible: false }],
			[name],
			[name, row, row],
			[
				name,
				{ ...row, field: { ...row.field, scope: { rows: [{ name: "outer", token: {} }, row.field.scope.rows[1]] } } },
			],
		]) {
			expect(capture?.(context, { ...request, fields }).status).not.toBe("found");
		}
		state.rows[0]?.nested.push({ token: {}, revision: {}, quantity: "new", nested: [], readOnly: false });
		expect(capture?.(context, request).status).not.toBe("found");
		expect(state.outgoing).toBeUndefined();
	},
);

it.each([generatedHost, independentHost])("new equal-shaped issue cannot spend old proof", async (factory) => {
	const origin = { validator: 0, source: "schema" as const, path: ["profile", "name"], message: "required" };
	const { host, context, state, request } = setup(factory, origin);
	state.issueRecords = [{ ...origin, ordinal: 0 }];
	state.validators = [() => [{ source: origin.source, path: origin.path, message: origin.message }]];
	const capture = host.strategy.captureOmission?.(context, request);
	if (capture?.status !== "found") throw Error("missing candidate");
	const candidate = { ...request, candidate: capture.candidate };
	const receipt = await host.strategy.validateOutgoingCandidate?.(context, candidate, () => true);
	if (receipt?.status !== "applied") throw Error("missing proof");
	state.issueRecords = [{ ...origin, ordinal: 0 }];
	expect(host.strategy.submitOmission?.(context, { ...candidate, proof: receipt.proof }, () => true).status).not.toBe(
		"submitted",
	);
});

it.each([generatedHost, independentHost])("wrong alias and incomplete include inventory cannot omit", (factory) => {
	const { host, context, request } = setup(factory);
	const [name, row] = request.fields;
	if (!name || !row) throw Error("missing fields");
	const rows = row.field.scope.rows;
	expect(
		host.strategy.captureOmission?.(context, {
			...request,
			fields: [
				name,
				{
					...row,
					field: { ...row.field, scope: { rows: [{ name: "wrong", token: rows[0]?.token ?? {} }, ...rows.slice(1)] } },
				},
			],
		}).status,
	).not.toBe("found");
	expect(
		host.strategy.captureOmission?.(context, { ...request, hiddenValues: "include", fields: [name] }).status,
	).not.toBe("found");
});

it.each([generatedHost, independentHost])("async FINAL rejects draft changes without revision", async (factory) => {
	const { host, context, state, request } = setup(factory);
	let release: (() => void) | undefined;
	state.validators = [
		async () => {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return [];
		},
	];
	const captured = host.strategy.captureOmission?.(context, request);
	if (captured?.status !== "found") throw Error("missing candidate");
	const pending = host.strategy.validateOutgoingCandidate?.(
		context,
		{ ...request, candidate: captured.candidate },
		() => true,
	);
	state.name = "changed";
	await Promise.resolve();
	release?.();
	expect((await pending)?.status).not.toBe("applied");
});

it("independent host validates final bytes and rejects consumed proof and reordered draft", async () => {
	const { host, context, state, request } = setup(independentHost);
	const result = await privateOmission(host.strategy, context, () => true).submit(request, state.revision);
	expect(result).toEqual({ ok: true, status: "submitted" });
	expect(state.outgoing).toMatchObject({ profile: {} });
	expect(state.name).toBe("original");
	state.outgoing = undefined;
	const capture = host.strategy.captureOmission?.(context, request);
	if (capture?.status !== "found") throw Error("missing capture");
	const candidate = { ...request, candidate: capture.candidate };
	const proof = await host.strategy.validateOutgoingCandidate?.(context, candidate, () => true);
	if (proof?.status !== "applied") throw Error("missing proof");
	state.rows.reverse();
	expect(host.strategy.submitOmission?.(context, { ...candidate, proof: proof.proof }, () => true).status).not.toBe(
		"submitted",
	);
	expect(state.outgoing).toBeUndefined();
});

it("host-authorized hidden include retains outgoing value without changing the draft", async () => {
	const { host, context, state, request } = setup(independentHost);
	const fields = request.fields.map((entry, i) =>
		i === 0 ? { ...entry, submitWhenHidden: "include" as const } : entry,
	);
	expect(host.strategy.captureOmission?.(context, { ...request, fields }).status).toBe("conflict");
	host.setInclude(true);
	expect(
		await privateOmission(host.strategy, context, () => true).submit(
			{ hiddenValues: "omit-inactive", fields },
			state.revision,
		),
	).toEqual({ ok: true, status: "submitted" });
	expect(state.outgoing).toMatchObject({ profile: { name: "original" } });
	expect(state.name).toBe("original");
});

it("independent host refuses revocation or changed visibility after FINAL without mutation", async () => {
	for (const change of ["revoke", "visible"] as const) {
		const { host, context, state, request } = setup(independentHost);
		const capture = host.strategy.captureOmission?.(context, request);
		if (capture?.status !== "found") throw Error("missing capture");
		const candidate = { ...request, candidate: capture.candidate };
		const final = await host.strategy.validateOutgoingCandidate?.(context, candidate, () => true);
		if (final?.status !== "applied") throw Error("missing FINAL proof");
		if (change === "revoke") host.revoke();
		else host.setHidden(false);
		expect(host.strategy.submitOmission?.(context, { ...candidate, proof: final.proof }, () => true).status).not.toBe(
			"submitted",
		);
		expect(state.outgoing).toBeUndefined();
	}
});

it.each([generatedHost, independentHost])(
	"revocation fences old receipts and field callbacks at the same revision",
	async (factory) => {
		const { host, context, state, request } = setup(factory);
		const frame = host.strategy.captureLifecycle?.(context);
		if (!frame || "status" in frame) throw Error("missing lifecycle");
		const capture = host.strategy.captureOmission?.(context, request);
		if (capture?.status !== "found") throw Error("missing candidate");
		const candidate = { ...request, candidate: capture.candidate };
		const receipt = await host.strategy.validateOutgoingCandidate?.(context, candidate, () => true);
		if (receipt?.status !== "applied") throw Error("missing receipt");
		host.revoke();
		host.regrant();
		expect(state.revision).toBe(request.revision);
		const first = request.fields[0];
		if (!first) throw Error("missing field");
		expect(frame.field(first.field).status).not.toBe("found");
		expect(host.strategy.submitOmission?.(context, { ...candidate, proof: receipt.proof }, () => true).status).not.toBe(
			"submitted",
		);
		expect(state.outgoing).toBeUndefined();
	},
);

it.each([generatedHost, independentHost])(
	"rejects forged reset and changed draft without revision",
	async (factory) => {
		const { host, context, state, request } = setup(factory);
		expect(
			host.strategy.resetLifecycle?.(context, { ...request, contract: "forged" as "formbar-lifecycle-v1" }).status,
		).not.toBe("applied");
		const capture = host.strategy.captureOmission?.(context, request);
		if (capture?.status !== "found") throw Error("missing candidate");
		const candidate = { ...request, candidate: capture.candidate };
		const receipt = await host.strategy.validateOutgoingCandidate?.(context, candidate, () => true);
		if (receipt?.status !== "applied") throw Error("missing receipt");
		state.name = "changed";
		expect(host.strategy.submitOmission?.(context, { ...candidate, proof: receipt.proof }, () => true).status).not.toBe(
			"submitted",
		);
		expect(state.outgoing).toBeUndefined();
	},
);
