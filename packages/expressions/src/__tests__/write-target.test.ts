import { describe, expect, it, vi } from "vitest";
import { createExpressionService, failure } from "../index.js";

function writable(snapshot: () => unknown, segments: readonly (string | number)[]) {
	const write = vi.fn(() => ({ ok: true as const }));
	const service = createExpressionService({
		namespaces: { data: { getSnapshot: snapshot, subscribe: () => () => {}, write } },
	});
	const program = service.compile({ kind: "ref", ref: { namespace: "data", segments } });
	if (!program.ok) throw new Error("compile");
	return { service, result: service.resolveWritable(program.value), write };
}

describe("descriptor-safe write targets", () => {
	it("allows an object final property to be missing but rejects a missing intermediate", () => {
		const root = { parent: {} };
		const final = writable(() => root, ["parent", "new"]);
		expect(final.result.ok).toBe(true);
		if (final.result.ok) expect(final.result.value(1).ok).toBe(true);
		expect(final.write).toHaveBeenCalledOnce();
		const intermediate = writable(() => ({}), ["parent", "new"]);
		expect(intermediate.result).toEqual(failure("missing"));
		expect(intermediate.write).not.toHaveBeenCalled();
	});

	it.each(["-1", "-0", "01", "1.0", "1e0", "named", "4294967295"])(
		"rejects noncanonical array segment %s before provider write",
		(segment) => {
			const target = writable(() => ({ items: [1] }), ["items", segment]);
			expect(target.result.ok).toBe(false);
			expect(target.write).not.toHaveBeenCalled();
		},
	);

	it("allows existing and exact append indices, and rejects beyond length", () => {
		for (const segment of [0, "0", 1, "1"]) expect(writable(() => [1], [segment]).result.ok).toBe(true);
		for (const segment of [2, "2"]) expect(writable(() => [1], [segment]).result.ok).toBe(false);
	});

	it("rejects malformed arrays and target accessors without invoking getters", () => {
		const getter = vi.fn(() => 1);
		const accessor = Object.defineProperty({}, "x", { get: getter, enumerable: true });
		const hole = new Array(1);
		const extra = Object.defineProperty([1], "extra", { value: 2, enumerable: true });
		const symbol = Object.defineProperty([1], Symbol("extra"), { value: 2 });
		for (const [root, segments] of [
			[accessor, ["x"]],
			[hole, [0]],
			[extra, [0]],
			[symbol, [0]],
		] as const) {
			expect(writable(() => root, segments).result.ok).toBe(false);
		}
		expect(getter).not.toHaveBeenCalled();
	});

	it("revalidates immediately before provider invocation", () => {
		const getter = vi.fn(() => 1);
		let reads = 0;
		const valid = { x: 1 };
		const invalid = Object.defineProperty({}, "x", { get: getter, enumerable: true });
		const target = writable(() => (++reads < 3 ? valid : invalid), ["x"]);
		expect(target.result.ok).toBe(true);
		if (target.result.ok) expect(target.result.value(2).ok).toBe(false);
		expect(target.write).not.toHaveBeenCalled();
		expect(getter).not.toHaveBeenCalled();
	});
});
