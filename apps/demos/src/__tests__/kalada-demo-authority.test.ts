import { expect, it, vi } from "vitest";
import { literal } from "../demos/kalada-fixture-programs";
import { disposeDemoSession, installDemo } from "../runtime/kalada-demo-install";
import type { Context, Strategy } from "../runtime/kalada-demo-store";
import { createDemoStrategy } from "../runtime/kalada-demo-strategy";

const identity = { generation: "risk", fingerprint: "owned" };

it("reports authoritative validation/reset commits as applied while refusing replay of retired actions", async () => {
	const host = installDemo({
		version: 2,
		schema: { type: "object", properties: { name: { type: "string" } } },
		initialData: { name: "original" },
		definition: {
			version: 1,
			id: "lifecycle",
			root: {
				type: "group",
				id: "root",
				children: [
					{ id: "name", type: "field", widget: "text", binding: { namespace: "data", segments: ["name"] } },
					{ id: "validate", type: "action", action: "validate" },
					{ id: "reset", type: "action", action: "reset" },
				],
			},
		},
	});
	try {
		const validate = host.snapshot().tree.children?.find((node) => node.nodeId === "validate")?.action;
		expect((await validate?.invoke())?.status).toBe("applied");
		expect((await validate?.invoke())?.status).toBe("stale");
		expect(host.snapshot().controls[0].writers.value?.("edited").status).toBe("applied");
		const reset = host.snapshot().tree.children?.find((node) => node.nodeId === "reset")?.action;
		expect((await reset?.invoke())?.status).toBe("applied");
		expect((await reset?.invoke())?.status).toBe("stale");
		expect(host.snapshot().data).toEqual({ name: "original" });
	} finally {
		disposeDemoSession(host);
	}
});
const array = { namespace: "data" as const, path: ["rows"] };
const target = { namespace: "data" as const, path: ["rows", { row: "line" }] };
const definition = {
	version: 1,
	id: "risk",
	root: {
		type: "group",
		id: "root",
		children: [
			{
				type: "repeater",
				id: "rows",
				scope: "line",
				binding: { namespace: "data", segments: ["rows"] },
				children: [
					{ type: "field", id: "value", widget: "text", binding: { namespace: "data", segments: [], scope: "line" } },
					{
						type: "action",
						id: "move",
						action: "array.move",
						target: { namespace: "data", segments: ["rows"] },
						payload: literal({}),
					},
					{ type: "action", id: "remove", action: "array.remove", target: { namespace: "data", segments: ["rows"] } },
				],
			},
		],
	},
};
function fixture() {
	const installed = createDemoStrategy(
		identity,
		[
			{ path: array.path, kind: "array" },
			{ path: target.path, kind: "value" },
		],
		{ "root.children[0].children[0]": target.path },
		(_ref, value) => typeof value === "string",
		undefined,
		{},
		undefined,
		{ definition, arrayBounds: { '["rows"]': {} } },
	);
	const context: Context = {
		instance: {},
		policyGeneration: identity.generation,
		policyFingerprint: identity.fingerprint,
	};
	installed.strategy.identity(context);
	installed.strategy.initializeSchema?.(context, {
		contract: "formbar-schema-initialization-v1",
		instance: context.instance,
		revision: installed.strategy.current(context),
		defaults: [],
		overrides: { rows: ["first", "second"] },
	});
	return { ...installed, context };
}
function rows(strategy: Strategy, context: Context) {
	const found = strategy.capture(context).enumerateRows?.({ rows: [] }, array, "line", 10);
	if (found?.status !== "found") throw new Error("Missing owned rows");
	return found.rows;
}
function request(strategy: Strategy, context: Context, row: ReturnType<typeof rows>[number]) {
	return {
		contract: "formbar-direct-write-v1" as const,
		reference: target,
		targetKind: "row-value" as const,
		expectedInstance: context.instance,
		expectedRevision: strategy.current(context),
		expectedRowRevision: row.writeRevision as object,
		scope: row.scope,
		value: "edited",
	};
}

it("commits token-based reorder/removal and rejects stale callbacks, stolen form/scope tokens and wrong types with zero mutation", () => {
	const a = fixture();
	const b = fixture();
	try {
		const before = rows(a.strategy, a.context);
		const stale = request(a.strategy, a.context, before[0]);
		const mutate = {
			contract: "formbar-array-action-v1" as const,
			operation: "array.move" as const,
			target: array,
			instance: a.context.instance,
			revision: a.strategy.current(a.context),
			scope: before[1].scope,
			row: { token: before[1].token, revision: before[1].writeRevision as object },
			destination: { token: before[0].token, revision: before[0].writeRevision as object },
			payload: {},
		};
		expect(a.arrayHost.mutateArray(a.context, mutate).status).toBe("applied");
		expect(a.strategy.writeDirect?.(a.context, stale).status).not.toBe("applied");
		const reordered = rows(a.strategy, a.context);
		expect(reordered.map((row) => row.token)).toEqual([before[1].token, before[0].token]);
		const fresh = request(a.strategy, a.context, reordered[0]);
		const draft = a.strategy.captureSubmission?.(a.context);
		const revision = a.strategy.current(a.context);
		for (const forged of [
			{ ...fresh, value: 42 },
			{ ...fresh, expectedInstance: b.context.instance },
			{ ...fresh, scope: rows(b.strategy, b.context)[0].scope },
			{ ...fresh, scope: { rows: [{ name: "wrong", token: before[1].token }] } },
		])
			expect(a.strategy.writeDirect?.(a.context, forged).status).not.toBe("applied");
		expect(a.strategy.current(a.context)).toBe(revision);
		expect(a.strategy.captureSubmission?.(a.context)).toEqual(draft);
		expect(
			a.arrayHost.mutateArray(a.context, {
				...mutate,
				operation: "array.remove",
				revision,
				scope: reordered[0].scope,
				row: { token: reordered[0].token, revision: reordered[0].writeRevision as object },
				destination: undefined,
			}).status,
		).toBe("applied");
		expect(a.strategy.writeDirect?.(a.context, fresh).status).not.toBe("applied");
		expect(a.strategy.captureSubmission?.(a.context)).toMatchObject({ data: { rows: ["first"] } });
	} finally {
		a.revoke();
		b.revoke();
	}
});

it("rotates reset/replacement and revoke-to-regrant without reviving old primitive callbacks", () => {
	const a = fixture();
	const old = request(a.strategy, a.context, rows(a.strategy, a.context)[0]);
	expect(
		a.strategy.resetLifecycle?.(a.context, {
			contract: "formbar-lifecycle-v1",
			instance: a.context.instance,
			revision: old.expectedRevision,
		}).status,
	).toBe("applied");
	expect(rows(a.strategy, a.context)[0].token).not.toBe(old.scope.rows[0].token);
	expect(a.strategy.writeDirect?.(a.context, old).status).not.toBe("applied");
	const retired = request(a.strategy, a.context, rows(a.strategy, a.context)[0]);
	a.revoke();
	const next = a.reinstall();
	next.strategy.identity(a.context);
	expect(a.strategy.writeDirect?.(a.context, retired).status).not.toBe("applied");
	expect(
		next.strategy.writeDirect?.(a.context, { ...retired, expectedRevision: next.strategy.current(a.context) }).status,
	).toBe("applied");
	expect(next.strategy.captureSubmission?.(a.context)).toMatchObject({ data: { rows: ["edited", "second"] } });
	next.revoke();
});

it("rejects forged omission visibility/inventory and FINAL-validates before consuming a one-shot receipt", async () => {
	const submit = vi.fn();
	const hidden = {
		version: 1,
		id: "omit",
		submission: { hiddenValues: "omit-inactive" },
		root: {
			type: "group",
			id: "root",
			children: [
				{
					id: "secret",
					type: "field",
					widget: "text",
					binding: { namespace: "data", segments: ["secret"] },
					visible: literal(false),
				},
			],
		},
	};
	const installed = createDemoStrategy(
		identity,
		[{ path: ["secret"], kind: "value" }],
		{ "root.children[0]": ["secret"] },
		(_ref, value) => typeof value === "string",
		submit,
		{},
		undefined,
		{ definition: hidden },
	);
	const context: Context = { instance: {}, policyGeneration: "risk", policyFingerprint: "owned" };
	installed.strategy.identity(context);
	const strategy = installed.strategy;
	strategy.initializeSchema?.(context, {
		contract: "formbar-schema-initialization-v1",
		instance: context.instance,
		revision: strategy.current(context),
		defaults: [],
		overrides: { secret: "private" },
	});
	const base = {
		contract: "formbar-lifecycle-v1" as const,
		instance: context.instance,
		revision: strategy.current(context),
		hiddenValues: "omit-inactive" as const,
		fields: [{ field: { path: "root.children[0]", scope: { rows: [] } }, visible: false }],
	};
	expect(strategy.captureOmission?.(context, { ...base, fields: [] }).status).toBe("conflict");
	expect(strategy.captureOmission?.(context, { ...base, fields: [{ ...base.fields[0], visible: true }] }).status).toBe(
		"conflict",
	);
	strategy.installSchemaValidation?.(context, [
		() => [{ path: ["secret"], message: "FINAL required", source: "schema" }],
	]);
	expect((await strategy.validateOutgoingCandidate?.(context, { ...base, candidate: {} }, () => true))?.status).toBe(
		"invalid",
	);
	expect(submit).not.toHaveBeenCalled();
	expect(strategy.captureSubmission?.(context)).toMatchObject({ data: { secret: "private" } });
	strategy.installSchemaValidation?.(context, []);
	const validated = await strategy.validateOutgoingCandidate?.(context, { ...base, candidate: {} }, () => true);
	if (validated?.status !== "applied") throw new Error("Missing FINAL receipt");
	const receipt = { ...base, candidate: {}, proof: validated.proof };
	expect((await strategy.submitOmission?.(context, receipt, () => true))?.status).toBe("submitted");
	expect((await strategy.submitOmission?.(context, receipt, () => true))?.status).not.toBe("submitted");
	expect(submit).toHaveBeenCalledExactlyOnceWith({});
	installed.revoke();
});
