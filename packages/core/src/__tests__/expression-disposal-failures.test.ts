import { createExpressionService, failure } from "@formbar/expressions";
import { createKueryBackend } from "@formbar/expressions-kuery";
import { describe, expect, it, vi } from "vitest";
import { ref } from "../../../../test/expression-fixtures.js";
import { createCoreExpressionNamespaces, createForm } from "../index.js";

describe("R2 core disposal cannot be interrupted by expression lifetime observers", () => {
	it("consumes rejected async disposal observers/teardown callbacks without leaking rejection events", async () => {
		const errors: unknown[] = [];
		const onRejected = (reason: unknown) => {
			errors.push(reason);
		};
		process.on("unhandledRejection", onRejected);
		try {
			const rejected = () => Promise.reject(new Error("SECRET disposal"));
			const cleaned = vi.fn();
			const form = createForm({
				plugins: [
					{ id: "async", onDispose: rejected, onInit: () => rejected },
					{ id: "last", onDispose: cleaned },
				],
				middleware: [{ id: "async", onDispose: rejected }],
			});
			form.onDispose(rejected);
			form.dispose();
			form.dispose();
			expect(cleaned).toHaveBeenCalledTimes(1);
			expect(form.getDisposalDiagnostics()).toEqual([{ code: "adapter" }]);
			await new Promise((resolve) => setTimeout(resolve, 25));
			expect(errors).toEqual([]);
		} finally {
			process.off("unhandledRejection", onRejected);
		}
	});
	it("attempts every observer, plugin handle and middleware and finalizes the store exactly once", () => {
		const log: string[] = [];
		const form = createForm({
			initialData: { x: 1 },
			plugins: [
				{
					id: "first",
					onDispose() {
						log.push("plugin-first");
						form.dispose();
						throw new Error("SECRET plugin");
					},
					onInit: () => () => {
						log.push("handle-first");
						throw new Error("SECRET handle");
					},
				},
				{
					id: "second",
					onDispose: () => {
						log.push("plugin-second");
					},
					onInit: () => () => {
						log.push("handle-second");
					},
				},
			],
			middleware: [
				{
					id: "first",
					onDispose() {
						log.push("middleware-first");
						throw new Error("SECRET middleware");
					},
				},
				{
					id: "second",
					onDispose: () => {
						log.push("middleware-second");
					},
				},
			],
		});
		form.onDispose(() => {
			log.push("observer-first");
			form.dispose();
			throw new Error("SECRET observer");
		});
		form.onDispose(() => {
			log.push("observer-second");
		});
		const service = createExpressionService({
			backend: createKueryBackend(),
			namespaces: createCoreExpressionNamespaces(form),
		});
		const binding = service.resolveProps({ value: { mode: "write", expression: ref("x") } });
		const notified = vi.fn();
		binding.subscribe(notified);
		const setter = binding.getSnapshot().setters.value;
		const stateListener = vi.fn();
		form.subscribe(stateListener);
		expect(() => form.dispose()).not.toThrow();
		expect(log).toEqual([
			"observer-first",
			"observer-second",
			"plugin-first",
			"plugin-second",
			"handle-first",
			"handle-second",
			"middleware-first",
			"middleware-second",
		]);
		expect(form.isDisposed()).toBe(true);
		expect(binding.getSnapshot().values.value).toBeUndefined();
		expect(notified).toHaveBeenCalledTimes(1);
		expect(setter(2)).toEqual(failure("disposed"));
		expect(form.getDisposalDiagnostics()).toEqual([{ code: "adapter" }]);
		form.dispose();
		expect(log).toHaveLength(8);
		form.setValue("x", 3);
		expect(stateListener).not.toHaveBeenCalled();
		service.dispose();
	});
	it("contains late observers and rejects reentrant repeats without interrupting later notifications", () => {
		const form = createForm();
		form.dispose();
		expect(() =>
			form.onDispose(() => {
				form.dispose();
				throw new Error("SECRET late observer");
			}),
		).not.toThrow();
		const observer = vi.fn();
		form.onDispose(observer);
		expect(observer).toHaveBeenCalledTimes(1);
		expect(form.getDisposalDiagnostics()).toEqual([{ code: "adapter" }]);
	});
});
