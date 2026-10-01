import { describe, expect, it } from "vitest";
import { createFormRuntime } from "../index.js";
import { installedField, installedOutput, program } from "./kalada-runtime-fixtures.js";

describe("host-installed Kalada V1 expression slots", () => {
	it("evaluates a canonical literal and a host data read across revisions", () => {
		const { runtime, state, host } = installedOutput({
			kind: "ref",
			ref: { namespace: "data", segments: ["profile", "name"] },
		});
		expect(runtime.snapshot().outputs[0]?.value).toBe("original");
		state.field.value = "changed";
		host.bump(state);
		expect(runtime.snapshot().outputs[0]?.value).toBe("changed");
		runtime.dispose();
	});

	it.each([true, false])("selects Conditional.condition %s without deferring basic branching to #409", (choice) => {
		const field = installedField();
		const accepted = field.admitOutput({
			version: 1,
			id: "conditional",
			root: {
				type: "conditional",
				id: "choice",
				condition: program({ kind: "literal", value: choice }),
				// biome-ignore lint/suspicious/noThenProperty: Serialized conditional branch, not a thenable.
				then: [{ type: "output", id: "yes", value: program({ kind: "literal", value: "yes" }) }],
				else: [{ type: "output", id: "no", value: program({ kind: "literal", value: "no" }) }],
			},
		});
		expect(accepted.ok).toBe(true);
		if (accepted.ok) {
			const runtime = createFormRuntime({ definition: accepted.value });
			expect(runtime.snapshot().outputs.map((output) => output.value)).toEqual([choice ? "yes" : "no"]);
			runtime.dispose();
		}
		field.runtime.dispose();
	});

	it("requires Boolean condition, not null or string truthiness", () => {
		const field = installedField();
		const accepted = field.admitOutput({
			version: 1,
			id: "nonboolean",
			root: {
				type: "conditional",
				id: "choice",
				condition: program({ kind: "literal", value: null }),
				// biome-ignore lint/suspicious/noThenProperty: Serialized conditional branch, not a thenable.
				then: [],
				else: [],
			},
		});
		expect(accepted.ok).toBe(true);
		if (accepted.ok) {
			const runtime = createFormRuntime({ definition: accepted.value });
			expect(() => runtime.snapshot()).toThrow("root.condition: BOOLEAN_REQUIRED");
			runtime.dispose();
		}
		field.runtime.dispose();
	});

	it("rejects a legacy operator at the exact condition slot instead of invoking Kuery", () => {
		const field = installedField();
		expect(
			field.admitOutput({
				version: 1,
				id: "old",
				root: {
					type: "conditional",
					id: "choice",
					condition: { kind: "literal", value: true },
					// biome-ignore lint/suspicious/noThenProperty: Serialized conditional branch, not a thenable.
					then: [],
				},
			}),
		).toMatchObject({
			ok: false,
			diagnostics: [{ path: ["root", "condition"], message: "RE-AUTHOR" }],
		});
		field.runtime.dispose();
	});
});
