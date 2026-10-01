import { describe, expect, it } from "vitest";
import { installedField, program } from "./kalada-runtime-fixtures.js";

describe("#291 whole-data submission, not the legacy omission supplier", () => {
	it("includes host data even if the control is hidden", async () => {
		const { runtime, host } = installedField({ visible: program({ kind: "literal", value: false }) });
		expect(runtime.snapshot().controls).toEqual([]);
		expect(await runtime.submit()).toEqual({ status: "submitted" });
		expect(host.submissions[0]).toMatchObject({ profile: { name: "original" } });
		runtime.dispose();
	});

	it("requires host omission ports at its exact policy path (#408)", () => {
		const { runtime, candidate, admit } = installedField();
		expect(admit({ ...candidate, submission: { hiddenValues: "omit-inactive" } })).toMatchObject({
			ok: false,
			diagnostics: [{ path: ["submission", "hiddenValues"], message: "OMISSION_STRATEGY_REQUIRED" }],
		});
		runtime.dispose();
	});

	it("rejects old Kuery hidden visibility at its exact field slot (#408)", () => {
		const { runtime, candidate, admit } = installedField();
		expect(
			admit({ ...candidate, root: { ...candidate.root, visible: { kind: "literal", value: false } } }),
		).toMatchObject({
			ok: false,
			diagnostics: [{ path: ["root", "visible"], message: "RE-AUTHOR" }],
		});
		runtime.dispose();
	});
});
