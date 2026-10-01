import { describe, expect, it } from "vitest";
import { installedField, installedOutput, program } from "./runtime-fixtures.js";

describe("host-installed public runtime snapshots", () => {
	it("captures a strict required Boolean and a coherent host data revision", () => {
		const { runtime, state } = installedField({ required: program({ kind: "literal", value: true }) });
		const snapshot = runtime.snapshot();
		expect(snapshot.revision).toBe(state.revision);
		expect(snapshot.controls).toMatchObject([{ nodeId: "name", value: "original", required: true }]);
		expect(snapshot.data).toMatchObject({ profile: { name: "original" } });
		runtime.dispose();
	});

	it("projects authored output with the same host data revision and no implicit write", () => {
		const { runtime, state, host } = installedOutput({
			kind: "ref",
			ref: { namespace: "data", segments: ["profile", "name"] },
		});
		const before = runtime.snapshot();
		expect(before.outputs).toMatchObject([{ value: "original", format: "plain" }]);
		expect(before.revision).toBe(state.revision);
		state.field.value = "updated";
		host.bump(state);
		expect(runtime.snapshot().outputs[0]?.value).toBe("updated");
		runtime.dispose();
	});

	it("writes only through the checked host writer and rejects a stale retained writer", () => {
		const { runtime, state } = installedField();
		const writer = runtime.snapshot().controls[0]?.writers.value;
		expect(writer?.("updated")).toEqual({ status: "applied" });
		expect(state.field.value).toBe("updated");
		expect(writer?.("stale")).toEqual({ status: "stale" });
		expect(runtime.snapshot().controls[0]?.value).toBe("updated");
		runtime.dispose();
	});

	it("withholds hidden controls while preserving whole-data submission capture", () => {
		const { runtime } = installedField({ visible: program({ kind: "literal", value: false }) });
		expect(runtime.snapshot().controls).toEqual([]);
		expect(runtime.snapshot().data).toMatchObject({ profile: { name: "original" } });
		runtime.dispose();
	});

	it("withholds writers for disabled and read-only controls", () => {
		for (const name of ["disabled", "readOnly"]) {
			const { runtime } = installedField({ [name]: program({ kind: "literal", value: true }) });
			expect(runtime.snapshot().controls[0]).toMatchObject({ [name]: true, writers: {} });
			runtime.dispose();
		}
	});

	it("rejects old Kuery form-lifecycle references at their exact program slot", () => {
		const { runtime, candidate, admit } = installedField();
		runtime.dispose();
		const old = { kind: "ref", ref: { namespace: "form", segments: ["dirty"] } };
		const result = admit({ ...candidate, root: { ...candidate.root, required: old } });
		expect(result).toMatchObject({
			ok: false,
			diagnostics: [{ path: ["root", "required"], message: "RE-AUTHOR" }],
		});
	});
});
