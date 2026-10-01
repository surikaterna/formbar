import { describe, expect, it } from "vitest";
import { installedField, program } from "./kalada-runtime-fixtures.js";

describe("#291 host whole-data submission projection", () => {
	it("submits the same current revision of host data after a checked WRITE", async () => {
		const { runtime, host } = installedField();
		expect(runtime.snapshot().controls[0]?.writers.value?.("next")).toEqual({ status: "applied" });
		const current = runtime.snapshot();
		expect(await runtime.submit()).toEqual({ status: "submitted" });
		expect(host.submissions).toEqual([current.data]);
		expect(current.data).toMatchObject({ profile: { name: "next" } });
		runtime.dispose();
	});

	it("does not project away hidden host data or mutate it on submission", async () => {
		const { runtime, state, host } = installedField({ visible: program({ kind: "literal", value: false }) });
		expect(runtime.snapshot().controls).toEqual([]);
		expect(await runtime.submit()).toEqual({ status: "submitted" });
		expect(host.submissions[0]).toEqual(runtime.snapshot().data);
		expect(state.field.value).toBe("original");
		runtime.dispose();
	});

	it("requires omission ports rather than falling back to include (#408)", () => {
		const { runtime, candidate, admit } = installedField();
		expect(admit({ ...candidate, submission: { hiddenValues: "omit-inactive" } })).toMatchObject({
			ok: false,
			diagnostics: [{ path: ["submission", "hiddenValues"], message: "OMISSION_STRATEGY_REQUIRED" }],
		});
		runtime.dispose();
	});
});
