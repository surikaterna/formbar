import { describe, expect, it, vi } from "vitest";
import { namespace, ref } from "../../../../test/expression-fixtures.js";
import { copyJson, createExpressionService, failure } from "../index.js";
import type { ExpressionBackend, PropDefinitions, Scopes } from "../index.js";

const identity: ExpressionBackend = {
	id: "identity",
	compile: (expression) => ({
		ok: true,
		value: {
			evaluate: (read) =>
				expression.kind === "ref" ? read(expression.ref) : expression.kind === "literal" ? expression.value : null,
		},
	}),
};
interface Poisoned {
	readonly promise: Promise<never>;
	readonly getter: ReturnType<typeof vi.fn>;
}

function handledRejection(): Promise<never> {
	const promise = Promise.reject(new Error("SECRET rejection"));
	void Promise.prototype.then.call(promise, undefined, () => {});
	return promise;
}

function poisonConstructor(): Poisoned {
	const promise = handledRejection();
	const getter = vi.fn(() => {
		throw new Error("SECRET constructor getter");
	});
	Object.defineProperty(promise, "constructor", { get: getter });
	return { promise, getter };
}

function poisonSpecies(): Poisoned {
	const promise = handledRejection();
	const getter = vi.fn(() => {
		throw new Error("SECRET species getter");
	});
	const speciesOwner = Object.defineProperty({}, Symbol.species, { get: getter });
	Object.defineProperty(promise, "constructor", { value: speciesOwner });
	return { promise, getter };
}

function handledSubclass(): Promise<never> {
	class CustomPromise<T> extends Promise<T> {}
	const promise = CustomPromise.reject(new Error("SECRET subclass"));
	void promise.catch(() => {});
	return promise;
}

async function withoutUnhandled(run: () => void): Promise<void> {
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

describe("R3 Promise accessor trust boundary", () => {
	it.each([
		JSON.parse('{"then":"plain-json"}'),
		JSON.parse('{"then":null}'),
		JSON.parse('{"then":{"status":"plain-json"}}'),
		JSON.parse('{"nested":{"then":"plain-json","value":[{"then":null}]}}'),
	])("preserves plain JSON then fields through literals, backend results and namespace reads: %j", (value) => {
		expect(copyJson(value)).toEqual(value);
		const literalService = createExpressionService({ backend: identity });
		const literal = literalService.compile({ kind: "literal", value });
		if (!literal.ok) throw new Error("compile");
		expect(literalService.evaluate(literal.value)).toEqual({ ok: true, value });
		const backend: ExpressionBackend = {
			id: "result",
			compile: () => ({ ok: true, value: { evaluate: () => value } }),
		};
		const backendService = createExpressionService({ backend });
		const result = backendService.compile({ kind: "literal", value: 1 });
		if (!result.ok) throw new Error("compile");
		expect(backendService.evaluate(result.value)).toEqual({ ok: true, value });
		const namespaceService = createExpressionService({
			backend: identity,
			namespaces: { data: namespace(value).provider },
		});
		const root = namespaceService.compile({ kind: "ref", ref: { namespace: "data", segments: [] } });
		if (!root.ok) throw new Error("compile");
		expect(namespaceService.evaluate(root.value)).toEqual({ ok: true, value });
		literalService.dispose();
		backendService.dispose();
		namespaceService.dispose();
	});
	it("rejects safely handled Promise subclasses without intrinsic chaining", async () => {
		await withoutUnhandled(() => {
			const service = createExpressionService({
				backend: identity,
				namespaces: { data: { ...namespace({ x: 1 }).provider, getSnapshot: handledSubclass } },
			});
			const program = service.compile({ kind: "ref", ref: { namespace: "data", segments: [] } });
			if (!program.ok) throw new Error("compile");
			expect(service.evaluate(program.value)).toEqual(failure("adapter"));
			service.dispose();
		});
	});
	it.each([poisonConstructor, poisonSpecies])(
		"rejects poisoned Promises at every untrusted JSON boundary without getters",
		async (makePoisoned) => {
			await withoutUnhandled(() => {
				const values = Array.from({ length: 6 }, makePoisoned);
				expect(() => copyJson(values[0].promise)).toThrow(/^invalid-input$/);
				const compile = vi.fn(identity.compile);
				const service = createExpressionService({ backend: { id: "spy", compile } });
				expect(service.compile({ kind: "literal", value: values[1].promise }).ok).toBe(false);
				expect(compile).not.toHaveBeenCalled();
				const props = service
					.resolveProps({ value: { mode: "literal", value: values[2].promise } } as unknown as PropDefinitions)
					.getSnapshot();
				expect(props.values["*"]).toBeUndefined();
				expect(props.diagnostics["*"]).toEqual([{ code: "invalid-input" }]);
				expect(() =>
					createExpressionService({ backend: identity, scopes: { item: values[3].promise } as unknown as Scopes }),
				).toThrow(/^invalid-input$/);
				const state = namespace({ x: 1 });
				const writableService = createExpressionService({ backend: identity, namespaces: { data: state.provider } });
				const program = writableService.compile(ref("x"));
				if (!program.ok) throw new Error("compile");
				const writable = writableService.resolveWritable(program.value);
				if (!writable.ok) throw new Error("writable");
				expect(writable.value(values[4].promise as never)).toEqual(failure("invalid-input"));
				expect(state.writes).toEqual([]);
				const readService = createExpressionService({
					backend: identity,
					namespaces: { data: namespace({ x: values[5].promise }).provider },
				});
				const read = readService.compile(ref("x"));
				if (!read.ok) throw new Error("compile");
				expect(readService.evaluate(read.value)).toEqual(failure("invalid-input"));
				for (const value of values) expect(value.getter).not.toHaveBeenCalled();
				service.dispose();
				writableService.dispose();
				readService.dispose();
			});
		},
	);
	it.each([poisonConstructor, poisonSpecies])(
		"rejects poisoned trusted callback results without executing accessors",
		async (makePoisoned) => {
			await withoutUnhandled(() => {
				const poisoned = makePoisoned();
				const service = createExpressionService({
					backend: identity,
					namespaces: { data: { ...namespace({ x: 1 }).provider, getSnapshot: () => poisoned.promise } },
				});
				const program = service.compile({ kind: "ref", ref: { namespace: "data", segments: [] } });
				if (!program.ok) throw new Error("compile");
				expect(service.evaluate(program.value)).toEqual(failure("adapter"));
				expect(poisoned.getter).not.toHaveBeenCalled();
				service.dispose();
			});
		},
	);
});
