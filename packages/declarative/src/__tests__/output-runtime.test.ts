import { describe, expect, it } from "vitest";
import { createFormRuntime } from "../index.js";
import { installedField, installedOutput, program } from "./kalada-runtime-fixtures.js";

describe("host-installed computed Output.value", () => {
	it.each([null, true, 5, "ready", { nested: [false] }])("projects JSON literal %j without a writer", (value) => {
		const { runtime } = installedOutput({ kind: "literal", value });
		expect(runtime.snapshot().outputs).toMatchObject([{ value, format: "plain" }]);
		expect(runtime.snapshot().controls).toEqual([]);
		runtime.dispose();
	});

	it("projects a host read across revisions without storing or writing a result", () => {
		const { runtime, state, host } = installedOutput({
			kind: "ref",
			ref: { namespace: "data", segments: ["profile", "name"] },
		});
		expect(runtime.snapshot().outputs[0]?.value).toBe("original");
		state.field.value = "updated";
		host.bump(state);
		expect(runtime.snapshot().outputs[0]?.value).toBe("updated");
		runtime.dispose();
	});

	it("rejects an old bare Kuery expression at the exact value slot", () => {
		const field = installedField();
		const result = field.admitOutput({
			version: 1,
			id: "bad-output",
			root: { type: "output", id: "out", value: { kind: "literal", value: 1 }, format: "plain" },
		});
		expect(result).toMatchObject({ ok: false, diagnostics: [{ path: ["root", "value"], message: "RE-AUTHOR" }] });
		field.runtime.dispose();
	});

	it("admits advanced format (#409) without losing the scalar value", () => {
		const field = installedField();
		const result = field.admitOutput({
			version: 1,
			id: "advanced-output",
			root: { type: "output", id: "out", value: program({ kind: "literal", value: 1 }), format: "currency-usd" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const runtime = createFormRuntime({ definition: result.value });
			expect(runtime.snapshot().outputs).toMatchObject([{ value: 1, format: "currency-usd" }]);
			runtime.dispose();
		}
		field.runtime.dispose();
	});
});
