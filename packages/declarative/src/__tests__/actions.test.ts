import { createForm } from "@formbar/core";
import { describe, expect, it, vi } from "vitest";
import type { FormNode, JsonValue } from "../index.js";
import { createActionExecutor, createFormRuntime } from "../index.js";
import { binding } from "./fixtures.js";
import { definition } from "./runtime-fixtures.js";

const key = (id: string) => JSON.stringify([id, []]);
const literal = (value: JsonValue) => ({ kind: "literal" as const, value });

function setup(nodes: readonly FormNode[], data: Record<string, unknown>, options = {}) {
	const form = createForm({ initialData: data, initialUiState: {}, ...options });
	const runtime = createFormRuntime({ form, definition: definition(nodes) });
	return { form, runtime };
}

describe("declarative actions", () => {
	it("runs custom handlers with only the current request, snapshot, runtime, and signal", async () => {
		const node: FormNode = {
			type: "action",
			id: "save",
			action: "host.save",
			payload: { kind: "ref", ref: binding(["name"]) },
		};
		const { form, runtime } = setup([node], { name: "Ada" });
		const handler = vi.fn();
		const executor = createActionExecutor({ form, runtime, actions: [{ id: "host.save", handler }] });
		const execution = executor.execute(key("save"));
		form.setValue("name", "Grace");
		expect(await execution).toEqual({ status: "completed" });
		expect(handler).toHaveBeenCalledOnce();
		const [request, context] = handler.mock.calls[0] ?? [];
		expect(request).toEqual({ action: "host.save", nodeId: "save", instanceKey: key("save"), payload: "Grace" });
		expect(Object.keys(context).sort()).toEqual(["runtime", "signal", "snapshot"]);
		expect(context.snapshot.data).toEqual({ name: "Grace" });
		expect(context.signal).toBeInstanceOf(AbortSignal);
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it("routes invalid declarative submit through the same core gate without calling onSubmit", async () => {
		const onSubmit = vi.fn();
		const issue = {
			code: "required",
			message: "Required",
			severity: "error" as const,
			path: { namespace: "data" as const, segments: ["name"], canonical: "name" },
			source: { origin: "function-validator" as const, validatorId: "required" },
		};
		const { form, runtime } = setup(
			[{ type: "action", id: "send", action: "submit" }],
			{ name: "" },
			{
				validators: [() => [issue]],
				onSubmit,
			},
		);
		const executor = createActionExecutor({ form, runtime });
		expect(await executor.execute(key("send"))).toEqual({ status: "completed" });
		expect(onSubmit).not.toHaveBeenCalled();
		expect(form.getState().meta.submitted).toBe(true);
		expect(form.getState().issues).toEqual([issue]);
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it("validates without submitting and reset restores the authoritative baseline", async () => {
		const issue = {
			code: "invalid",
			message: "Invalid",
			severity: "error" as const,
			path: { namespace: "data" as const, segments: ["name"], canonical: "name" },
			source: { origin: "function-validator" as const, validatorId: "validator" },
		};
		const { form, runtime } = setup(
			[
				{ type: "action", id: "check", action: "validate" },
				{ type: "action", id: "clear", action: "reset" },
			],
			{ name: "initial" },
			{ validators: [() => [issue]] },
		);
		const executor = createActionExecutor({ form, runtime });
		form.setValue("name", "edited");
		expect(await executor.execute(key("check"))).toEqual({ status: "completed" });
		expect(form.getState().issues).toEqual([issue]);
		expect(form.getState().meta.submitted).not.toBe(true);
		expect(await executor.execute(key("clear"))).toEqual({ status: "completed" });
		expect(form.getState().data).toEqual({ name: "initial" });
		expect(form.getState().issues).toEqual([]);
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it("uses only core array helpers for all five structural operations", async () => {
		const target = binding(["items"]);
		const nodes: FormNode[] = [
			{ type: "action", id: "append", action: "array.append", target, payload: literal("c") },
			{ type: "action", id: "insert", action: "array.insert", target, payload: literal({ item: "x", index: 1 }) },
			{ type: "action", id: "remove", action: "array.remove", target, payload: literal(2) },
			{ type: "action", id: "move", action: "array.move", target, payload: literal({ from: 2, to: 0 }) },
			{ type: "action", id: "swap", action: "array.swap", target, payload: literal({ from: 0, to: 2 }) },
		];
		const { form, runtime } = setup(nodes, { items: ["a", "b"] });
		const executor = createActionExecutor({ form, runtime });
		for (const id of ["append", "insert", "remove", "move", "swap"])
			expect(await executor.execute(key(id))).toEqual({ status: "completed" });
		expect(form.getState().data).toEqual({ items: ["x", "a", "c"] });
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it("uses the innermost repeater index only when an array index is omitted", async () => {
		const { form, runtime } = setup(
			[
				{
					type: "repeater",
					id: "rows",
					binding: binding(["items"]),
					scope: "row",
					children: [{ type: "action", id: "remove", action: "array.remove", target: binding(["items"]) }],
				},
			],
			{ items: ["a", "b"] },
		);
		const executor = createActionExecutor({ form, runtime });
		const instanceKey = JSON.stringify(["remove", [{ scope: "row", index: 1 }]]);
		expect(await executor.execute(instanceKey)).toEqual({ status: "completed" });
		expect(form.getState().data).toEqual({ items: ["a"] });
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it("blocks array mutation when current core target policy is restrictive", async () => {
		const { form, runtime } = setup(
			[
				{
					type: "action",
					id: "remove",
					action: "array.remove",
					target: binding(["items"]),
					payload: literal(0),
				},
			],
			{ items: ["private"] },
			{
				plugins: [
					{
						id: "permissions",
						evaluate: () => ({ fieldPolicy: [{ path: ["items"], readOnly: true }] }),
					},
				],
			},
		);
		form.dispatch({ type: "policy-refresh" });
		const executor = createActionExecutor({ form, runtime });
		expect(await executor.execute(key("remove"))).toEqual({
			status: "failed",
			diagnostic: "action-unavailable",
		});
		expect(form.getState().data).toEqual({ items: ["private"] });
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});

	it("fails closed for malformed arrays, payloads, unknown IDs, and untrusted registrations", async () => {
		const brokenHandler = vi.fn();
		const nodes: FormNode[] = [
			{ type: "action", id: "bad-array", action: "array.remove", target: binding(["name"]), payload: literal(0) },
			{
				type: "action",
				id: "bad-payload",
				action: "array.insert",
				target: binding(["items"]),
				payload: literal({ item: "secret", extra: 1 }),
			},
			{ type: "action", id: "unknown", action: "host.missing" },
			{
				type: "action",
				id: "broken-expression",
				action: "host.broken",
				payload: { kind: "ref", ref: binding(["missing"]) },
			},
		];
		const { form, runtime } = setup(nodes, { name: "private", items: ["a"] });
		const executor = createActionExecutor({
			form,
			runtime,
			actions: [
				{ id: "submit", handler: vi.fn() },
				{ id: "duplicate", handler: vi.fn() },
				{ id: "host.broken", handler: brokenHandler },
				{ id: "duplicate", handler: vi.fn() },
			],
		});
		expect(await executor.execute(key("bad-array"))).toMatchObject({
			status: "failed",
			diagnostic: "invalid-action-target",
		});
		expect(await executor.execute(key("bad-payload"))).toMatchObject({
			status: "failed",
			diagnostic: "invalid-action-payload",
		});
		expect(await executor.execute(key("unknown"))).toMatchObject({ status: "failed", diagnostic: "unknown-action" });
		expect(await executor.execute(key("broken-expression"))).toMatchObject({
			status: "failed",
			diagnostic: "invalid-action-payload",
		});
		expect(brokenHandler).not.toHaveBeenCalled();
		expect(form.getState().data).toEqual({ name: "private", items: ["a"] });
		expect(executor.getDiagnostics()).toEqual([
			{ code: "duplicate-action-registration", action: "duplicate" },
			{ code: "reserved-action-registration", action: "submit" },
		]);
		executor.dispose();
		runtime.dispose();
		form.dispose();
	});
});
