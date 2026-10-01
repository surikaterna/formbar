import { describe, expect, it, vi } from "vitest";
import { installedField, installedOutput } from "./kalada-runtime-fixtures.js";

describe("installed host adversarial captures", () => {
	it.each([Number.NaN, 1n, undefined, { some: () => "unexpected Option" }])(
		"fails closed on non-JSON host field value %s",
		(value) => {
			const { runtime, state, host } = installedField();
			state.field.value = value as string;
			host.bump(state);
			expect(() => runtime.snapshot()).toThrow();
			runtime.dispose();
		},
	);

	it.each(["missing", "denied"] as const)("denies a %s read instead of treating it as null", (status) => {
		const { runtime, state, host } = installedOutput({
			kind: "ref",
			ref: { namespace: "data", segments: ["profile", "name"] },
		});
		state.field[status] = true;
		host.bump(state);
		expect(() => runtime.snapshot()).toThrow("root.value:");
		runtime.dispose();
	});

	it("rejects an old captured frame after the host advances revision", () => {
		const { runtime, state, host } = installedField();
		const former = runtime.snapshot();
		const writer = former.controls[0]?.writers.value;
		state.field.value = "new";
		host.bump(state);
		expect(writer?.("overwritten")).toMatchObject({ status: "stale" });
		expect(runtime.snapshot().controls[0]?.value).toBe("new");
		runtime.dispose();
	});

	it("admission never reads host values or invokes an evaluator", () => {
		const field = installedField();
		const capture = vi.spyOn(field.host.strategy, "capture");
		expect(field.admit(field.candidate).ok).toBe(true);
		expect(capture).not.toHaveBeenCalled();
		field.runtime.dispose();
	});
});
