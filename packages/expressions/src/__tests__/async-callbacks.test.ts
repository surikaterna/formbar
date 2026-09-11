import { describe, expect, it, vi } from "vitest";
import { namespace, ref } from "../../../../test/expression-fixtures.js";
import { createExpressionService, failure, forwardExpressionProp } from "../index.js";
import type { Authorization, JsonValue, NamespaceProvider } from "../index.js";
const rejected = () => Promise.reject(new Error("SECRET async callback"));

async function noUnhandledRejections(run: () => void): Promise<void> {
	const unhandled: unknown[] = [];
	const listener = (reason: unknown) => {
		unhandled.push(reason);
	};
	process.on("unhandledRejection", listener);
	try {
		run();
		await new Promise((resolve) => setTimeout(resolve, 25));
		expect(unhandled).toEqual([]);
	} finally {
		process.off("unhandledRejection", listener);
	}
}

function serviceWith(provider: NamespaceProvider) {
	const service = createExpressionService({ namespaces: { data: provider } });
	const program = service.compile(ref("x"));
	if (!program.ok) throw new Error("compile");
	return { service, program: program.value };
}

describe("R3 synchronous callback boundaries contain native rejected promises", () => {
	it("contains rejected native snapshots from another realm without relying on instanceof", async () => {
		await noUnhandledRejections(() => {
			const { service, program } = serviceWith({
				...namespace({ x: 1 }).provider,
				getSnapshot: () => runInNewContext("Promise.reject(new Error('SECRET other realm'))"),
			});
			expect(service.evaluate(program)).toEqual(failure("adapter"));
			expect(service.resolveWritable(program)).toEqual(failure("adapter"));
			service.dispose();
		});
	});
	it("consumes async snapshots for root/field reads and writable target resolution", async () => {
		await noUnhandledRejections(() => {
			const { service, program } = serviceWith({ ...namespace({ x: 1 }).provider, getSnapshot: rejected });
			expect(service.evaluate(program)).toEqual(failure("adapter"));
			expect(service.resolveWritable(program)).toEqual(failure("adapter"));
			const root = service.compile({ kind: "ref", ref: { namespace: "data", segments: [] } });
			if (!root.ok) throw new Error("compile");
			expect(service.evaluate(root.value)).toEqual(failure("adapter"));
			service.dispose();
		});
	});
	it("rejects async snapshots during retained writes before any mutation", async () => {
		await noUnhandledRejections(() => {
			const state = namespace({ x: 1 });
			let async = false;
			const { service, program } = serviceWith({
				...state.provider,
				getSnapshot: () => (async ? rejected() : state.provider.getSnapshot()),
			});
			const writable = service.resolveWritable(program);
			if (!writable.ok) throw new Error("resolve");
			async = true;
			expect(writable.value(2)).toEqual(failure("adapter"));
			expect(state.writes).toEqual([]);
			service.dispose();
		});
	});
	it.each(["getVersion", "isDisposed"] as const)("consumes async %s capability checks", async (callback) => {
		await noUnhandledRejections(() => {
			const { service, program } = serviceWith({
				...namespace({ x: 1 }).provider,
				[callback]: rejected,
			} as NamespaceProvider);
			expect(service.resolveWritable(program)).toEqual(failure("adapter"));
			if (callback === "isDisposed") expect(service.evaluate(program)).toEqual(failure("adapter"));
			service.dispose();
		});
	});
	it("consumes async authorization instead of granting a truthy Promise", async () => {
		await noUnhandledRejections(() => {
			const service = createExpressionService({
				namespaces: { data: namespace({ x: 1 }).provider },
				authorize: rejected as unknown as Authorization,
			});
			const compiled = service.compile(ref("x"));
			if (!compiled.ok) throw new Error("compile");
			expect(service.evaluate(compiled.value)).toEqual(failure("adapter"));
			expect(service.resolveWritable(compiled.value)).toEqual(failure("adapter"));
		});
	});
	it("contains async subscribe, cleanup, and notifications and still attempts later callbacks", async () => {
		await noUnhandledRejections(() => {
			const bad = serviceWith({
				...namespace({ x: 1 }).provider,
				subscribe: rejected as unknown as NamespaceProvider["subscribe"],
			});
			expect(() => bad.service.observe(bad.program).subscribe(() => {})).toThrow(/^adapter$/);
			const state = namespace({ x: 1 });
			const { service, program } = serviceWith({
				...state.provider,
				subscribe(listener) {
					const stop = state.provider.subscribe(listener);
					return () => {
						stop();
						return rejected();
					};
				},
			});
			const observation = service.observe(program);
			observation.subscribe(rejected);
			const notified = vi.fn();
			observation.subscribe(notified);
			observation.getSnapshot();
			service.dispose();
			expect(notified).toHaveBeenCalledTimes(1);
			expect(state.listeners.size).toBe(0);
			expect(service.getLifecycleDiagnostics()).toEqual([{ code: "adapter" }]);
			expect(observation.getSnapshot()).toEqual(failure("disposed"));
		});
	});
	it("never executes thenable getters or an overridden native Promise then getter", async () => {
		await noUnhandledRejections(() => {
			const getter = vi.fn(() => {
				throw new Error("SECRET getter");
			});
			const withAccessor = (value: object, key: string) =>
				Object.defineProperty(value, key, { get: getter, enumerable: true });
			const thenable = withAccessor({}, "then");
			const promise = Promise.reject(new Error("SECRET async callback"));
			void Promise.prototype.then.call(promise, undefined, () => {});
			withAccessor(promise, "then");
			for (const value of [thenable, promise]) {
				const { service, program } = serviceWith(namespace({ x: value }).provider);
				expect(service.evaluate(program).ok).toBe(false);
			}
			expect(getter).not.toHaveBeenCalled();
		});
	});
	it("rejects asynchronous typed forwarding guards on reads and writes", async () => {
		await noUnhandledRejections(() => {
			let async = false;
			const accept = ((_: JsonValue) => (async ? rejected() : true)) as (value: JsonValue) => value is number;
			const state = namespace({ x: 1 });
			const { service } = serviceWith(state.provider);
			const binding = service.resolveProps({ value: { mode: "write", expression: ref("x") } });
			binding.subscribe(() => {});
			const forwarded = forwardExpressionProp(binding.getSnapshot(), "value", accept);
			if (!forwarded.ok) throw new Error("forward");
			async = true;
			expect(forwarded.value.setValue?.(2)).toEqual(failure("adapter"));
			expect(forwardExpressionProp(binding.getSnapshot(), "value", accept)).toEqual(failure("adapter"));
			expect(state.writes).toEqual([]);
			service.dispose();
		});
	});
});
import { runInNewContext } from "node:vm";
