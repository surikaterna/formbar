import { expect, it } from "vitest";
import type { OmissionRequest } from "../../../packages/declarative/src/validators/kalada-data-strategy.js";
import { privateOmission } from "../../../packages/declarative/src/validators/kalada-private-omission.js";
import { generatedHost } from "./generated-host.js";
import { independentHost } from "./kalada-independent-host-408.js";
import { hostSchema, validationHost } from "./kalada-validation-host-408.js";

const name = "root.children[0].children[0]";
const quantity = "root.children[1].children[0].children[0].children[0].children[0]";
const issue = (source: "schema" | "extension") => ({ path: ["profile", "name"], message: "same path", source });
const flush = async () => {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
};

function omissionFixture(factory: typeof independentHost | typeof generatedHost = independentHost) {
	const h = factory("outer", "inner", name);
	const context = { instance: {}, policyGeneration: "g1", policyFingerprint: "host" };
	const revision = h.strategy.current(context);
	const state = h.instances.get(context.instance);
	if (!state) throw Error("missing host draft");
	const fields = () => [
		{ field: { path: name, scope: { rows: [] } }, visible: false },
		...state.rows.flatMap((parent) =>
			parent.nested.map((child) => ({
				field: {
					path: quantity,
					scope: {
						rows: [
							{ name: "outer", token: parent.token },
							{ name: "inner", token: child.token },
						],
					},
				},
				visible: true,
			})),
		),
	];
	const request = (): OmissionRequest => ({
		contract: "formbar-lifecycle-v1",
		instance: context.instance,
		revision,
		hiddenValues: "omit-inactive",
		fields: fields(),
	});
	return { h, context, state, request };
}

it.each([independentHost, generatedHost])(
	"host policy rejects forgery, stale ownership and incomplete nested inventory",
	(factory) => {
		const { h, context, state, request } = omissionFixture(factory);
		const valid = request();
		expect(h.strategy.captureOmission?.(context, valid).status).toBe("found");
		const row = valid.fields[1];
		if (!row) throw Error("missing nested row");
		for (const forged of [
			{ ...valid, instance: {} },
			{ ...valid, revision: {} },
			{ ...valid, fields: [row] },
			{ ...valid, fields: [...valid.fields, row] },
			{ ...valid, fields: [{ ...valid.fields[0], visible: true }, row] },
			{ ...valid, fields: [valid.fields[0], { ...row, visible: false }] },
			{
				...valid,
				fields: [
					valid.fields[0],
					{
						...row,
						field: {
							...row.field,
							scope: {
								rows: [
									{ name: "outer", token: state.rows[0]?.token },
									{ name: "inner", token: {} },
								],
							},
						},
					},
				],
			},
			{
				...valid,
				fields: [
					valid.fields[0],
					{
						...row,
						field: {
							...row.field,
							scope: { rows: [{ name: "wrong", token: state.rows[0]?.token }, row.field.scope.rows[1]] },
						},
					},
				],
			},
		] as OmissionRequest[])
			expect(h.strategy.captureOmission?.(context, forged).status).not.toBe("found");
		state.rows[0]?.nested.push({ token: {}, revision: {}, quantity: "new", nested: [], readOnly: false });
		h.bump(state);
		expect(h.strategy.captureOmission?.(context, { ...valid, revision: state.revision }).status).not.toBe("found");
		expect(state.outgoing).toBeUndefined();
	},
);

it("independent host rechecks FINAL candidate, one-use proof, grant and current row ordering before commit", async () => {
	const { h, context, state, request } = omissionFixture();
	const capture = h.strategy.captureOmission?.(context, request());
	if (capture?.status !== "found") throw Error("capture failed");
	expect(capture.candidate).toEqual({ profile: {}, rows: [{ nested: [{ quantity: "child" }] }, { nested: [] }] });
	expect(state.name).toBe("original");
	const candidate = { ...request(), candidate: capture.candidate };
	expect(
		(
			await h.strategy.validateOutgoingCandidate?.(
				context,
				{ ...candidate, candidate: { profile: { name: "forged" }, rows: [] } },
				() => true,
			)
		)?.status,
	).toBe("conflict");
	const validated = await h.strategy.validateOutgoingCandidate?.(context, candidate, () => true);
	if (validated?.status !== "applied") throw Error("FINAL validation failed");
	const submission = { ...candidate, proof: validated.proof };
	expect(
		h.strategy.submitOmission?.(context, { ...submission, candidate: { profile: {}, rows: [] } }, () => true).status,
	).not.toBe("submitted");
	expect(h.strategy.submitOmission?.(context, submission, () => true).status).not.toBe("submitted");
	const freshProof = await h.strategy.validateOutgoingCandidate?.(context, candidate, () => true);
	if (freshProof?.status !== "applied") throw Error("fresh FINAL validation failed");
	const freshSubmission = { ...submission, proof: freshProof.proof };
	expect(h.strategy.submitOmission?.(context, freshSubmission, () => true).status).toBe("submitted");
	expect(h.strategy.submitOmission?.(context, freshSubmission, () => true).status).not.toBe("submitted");
	state.outgoing = undefined;
	const second = await h.strategy.validateOutgoingCandidate?.(context, candidate, () => true);
	if (second?.status !== "applied") throw Error("second validation failed");
	state.rows.reverse();
	expect(h.strategy.submitOmission?.(context, { ...submission, proof: second.proof }, () => true).status).not.toBe(
		"submitted",
	);
	state.rows.reverse();
	expect(h.strategy.submitOmission?.(context, { ...submission, proof: second.proof }, () => true).status).not.toBe(
		"submitted",
	);
	expect(state.outgoing).toBeUndefined();
	h.revoke();
	expect(h.strategy.captureOmission?.(context, request()).status).not.toBe("found");
});

it("independent policy retains an authorized hidden include and rejects a forged include", async () => {
	const { h, context, state, request } = omissionFixture();
	const forged = {
		...request(),
		fields: request().fields.map((entry, i) => (i ? entry : { ...entry, submitWhenHidden: "include" as const })),
	};
	expect(h.strategy.captureOmission?.(context, forged).status).toBe("conflict");
	h.setInclude(true);
	const port = privateOmission(h.strategy, context, () => true);
	expect(await port.submit({ hiddenValues: "omit-inactive", fields: forged.fields }, state.revision)).toEqual({
		ok: true,
		status: "submitted",
	});
	expect(state.outgoing).toMatchObject({ profile: { name: "original" } });
	expect(state.name).toBe("original");
});

it("independent policy fails closed on non-JSON and circular outgoing drafts", async () => {
	for (const invalid of [
		undefined,
		(() => {
			const cycle: Record<string, unknown> = {};
			cycle.self = cycle;
			return cycle;
		})(),
	]) {
		const { h, context, state, request } = omissionFixture();
		state.name = invalid as string;
		const result = await privateOmission(h.strategy, context, () => true).submit(
			{ ...request(), hiddenValues: "include" },
			state.revision,
		);
		expect(result.ok).toBe(false);
		expect(state.outgoing).toBeUndefined();
	}
});

it("independent coalescing host distinguishes lexical row change from blur and fences reset, revocation and disposal", async () => {
	for (const end of ["reset", "revoke", "dispose"] as const) {
		const signals: AbortSignal[] = [];
		let finish = (_value: readonly ReturnType<typeof issue>[]) => {};
		const pending = new Promise<readonly ReturnType<typeof issue>[]>((resolve) => {
			finish = resolve;
		});
		const called: string[] = [];
		const h = validationHost(
			hostSchema,
			{
				scopedValidators: [
					{
						id: "name",
						field: name,
						trigger: "onBlur",
						validate: (_data, signal) => {
							signals.push(signal);
							called.push("blur");
							return pending;
						},
					},
					{
						id: "row",
						field: quantity,
						trigger: "onChange",
						validate: () => {
							called.push("row");
							return [];
						},
					},
				],
			},
			independentHost,
		);
		const before = h.host.snapshot();
		const blur = before.controls.find(({ nodeId }) => nodeId === h.nameId)?.onBlur;
		const row = before.controls.find(({ nodeId }) => nodeId === h.quantityId);
		expect(blur?.().status).toBe("applied");
		await flush();
		expect(called).toEqual(["blur"]);
		expect(h.host.snapshot().data).toEqual(before.data);
		expect(row?.writers.value?.("updated").status).toBe("applied");
		await flush();
		expect(called).toEqual(["blur", "row"]);
		expect(signals[0]?.aborted).toBe(true);
		expect(h.host.snapshot().data).not.toEqual(before.data);
		expect(blur?.().status).toBe("stale");
		const current = h.host.snapshot().controls.find(({ nodeId }) => nodeId === h.nameId);
		expect(current?.onBlur?.().status).toBe("applied");
		await flush();
		if (end === "reset") expect(h.host.reset().ok).toBe(true);
		if (end === "revoke") h.installed.revoke();
		if (end === "dispose") h.host.dispose();
		finish([issue("extension")]);
		await pending;
		await flush();
		expect(signals.at(-1)?.aborted).toBe(true);
		expect([...h.installed.instances.values()][0]?.scopedIssues.size).toBe(0);
		if (end !== "dispose") h.host.dispose();
	}
});

it("independent provenance policy rejects extension on the same path and validates FINAL omitted bytes", async () => {
	const extensionCheck = () => [issue("extension")];
	// The schema validator occupies slot 0; the first installed extension occupies slot 1.
	const origin = { validator: 1, source: "extension" as const, path: ["profile", "name"], message: "same path" };
	const blocked = validationHost(
		hostSchema,
		{ omission: "omit-inactive", origin, validators: [extensionCheck, extensionCheck] },
		independentHost,
	);
	const blockedResult = await blocked.host.submit();
	// Equal paths cannot exempt a different validator's extension issue.
	expect(blockedResult.status).not.toBe("submitted");
	const blockedState = [...blocked.installed.instances.values()][0];
	expect(blockedState?.issueRecords).toEqual([
		{ ...issue("extension"), validator: 1, ordinal: 0 },
		{ ...issue("extension"), validator: 2, ordinal: 0 },
	]);
	expect(blockedState?.outgoing).toBeUndefined();
	blocked.host.dispose();
	const ancestor = validationHost(
		hostSchema,
		{
			omission: "omit-inactive",
			origin,
			validators: [() => [{ path: ["profile"], message: "same path", source: "extension" }]],
		},
		independentHost,
	);
	expect((await ancestor.host.submit()).status).not.toBe("submitted");
	expect([...ancestor.installed.instances.values()][0]?.outgoing).toBeUndefined();
	ancestor.host.dispose();
	const allowed = validationHost(
		hostSchema,
		{ omission: "omit-inactive", origin, validators: [extensionCheck] },
		independentHost,
	);
	const allowedState = [...allowed.installed.instances.values()][0];
	expect(allowedState?.issueRecords).toEqual([]);
	expect((await allowed.host.submit()).status).toBe("submitted");
	expect(allowedState?.issueRecords).toEqual([{ ...issue("extension"), validator: 1, ordinal: 0 }]);
	expect(JSON.stringify(allowedState?.outgoing)).toBe(
		'{"profile":{},"rows":[{"nested":[{"quantity":"child"}]},{"nested":[]}]}',
	);
	expect(allowed.host.snapshot().data).toMatchObject({ profile: { name: "original" } });
	allowed.host.dispose();
	const schemaBlocked = validationHost(
		{
			...hostSchema,
			properties: { ...hostSchema.properties, profile: { ...hostSchema.properties.profile, required: ["name"] } },
		},
		{ omission: "omit-inactive", origin, validators: [extensionCheck] },
		independentHost,
	);
	expect((await schemaBlocked.host.submit()).status).not.toBe("submitted");
	expect([...schemaBlocked.installed.instances.values()][0]?.outgoing).toBeUndefined();
	schemaBlocked.host.dispose();
});
