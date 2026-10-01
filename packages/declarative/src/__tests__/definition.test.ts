import { describe, expect, it, vi } from "vitest";
import { createFormRuntime, validateFormDefinition } from "../index.js";
import { installedField, program } from "./kalada-runtime-fixtures.js";

describe("installed Kalada V1 definition admission", () => {
	it("admits a native widget, Boolean slot and direct host writer without evaluating", () => {
		const field = installedField({ required: program({ kind: "literal", value: true }) });
		const read = vi.spyOn(field.host.strategy, "capture");
		const accepted = field.admit(field.candidate);
		expect(accepted.ok).toBe(true);
		if (accepted.ok) {
			expect(accepted.value.prepared.admitted.slots.map((slot) => slot.path)).toEqual(["root.required"]);
			expect(accepted.value.prepared.admitted.targets.has("root.binding")).toBe(true);
		}
		expect(read).not.toHaveBeenCalled();
		field.runtime.dispose();
	});

	it.each([
		["old expression", { required: { kind: "literal", value: true } }, ["root", "required"], "RE-AUTHOR"],
		[
			"reserved binding",
			{ binding: { namespace: "data", segments: ["__proto__"] } },
			["root", "binding"],
			"INVALID_BINDING",
		],
	])("denies %s at its exact path", (_name, change, path, message) => {
		const field = installedField();
		const result = field.admit({ ...field.candidate, root: { ...field.candidate.root, ...change } });
		expect(result).toMatchObject({ ok: false, diagnostics: [{ path, message }] });
		field.runtime.dispose();
	});

	it("admits an otherwise well-shaped host submit action (#407)", () => {
		const field = installedField();
		expect(
			field.admitOutput({ version: 1, id: "action", root: { type: "action", id: "send", action: "submit" } }),
		).toMatchObject({ ok: true });
		field.runtime.dispose();
	});

	it("projects responsive presentation on a native control (#409)", () => {
		const field = installedField();
		const result = field.admit({
			...field.candidate,
			root: { ...field.candidate.root, presentation: { span: { base: 12, md: 6 } } },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const runtime = createFormRuntime({ definition: result.value });
			expect(runtime.snapshot().controls[0]?.presentation?.span).toEqual({ base: 12, md: 6 });
			runtime.dispose();
		}
		field.runtime.dispose();
	});

	it("rejects unregistered widgets and omission without host ports", () => {
		const field = installedField();
		const { candidate, admit } = field;
		expect(admit({ ...candidate, root: { ...candidate.root, widget: "unregistered" } })).toMatchObject({
			ok: false,
			diagnostics: [{ path: ["root", "widget"], message: "MISSING_POLICY" }],
		});
		expect(
			admit({
				...candidate,
				root: { ...candidate.root, submitWhenHidden: "include" },
				submission: { hiddenValues: "omit-inactive" },
			}),
		).toMatchObject({
			ok: false,
			diagnostics: [{ path: ["submission", "hiddenValues"], message: "OMISSION_STRATEGY_REQUIRED" }],
		});
		field.runtime.dispose();
	});

	it("accepts explicit include for a hidden field only as whole-data submission", async () => {
		const field = installedField();
		const result = field.admit({
			...field.candidate,
			root: {
				...field.candidate.root,
				visible: program({ kind: "literal", value: false }),
				submitWhenHidden: "include",
			},
			submission: { hiddenValues: "include" },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			const runtime = createFormRuntime({ definition: result.value });
			const snapshot = runtime.snapshot();
			expect(snapshot.controls).toHaveLength(0);
			expect(await runtime.submit()).toEqual({ status: "submitted" });
			expect(field.host.submissions).toEqual([snapshot.data]);
			runtime.dispose();
		}
		field.runtime.dispose();
	});

	it("requires host policy rather than silently admitting without an installation", () => {
		const field = installedField();
		expect(validateFormDefinition(field.candidate)).toMatchObject({
			ok: false,
			diagnostics: [{ path: ["root"], message: "MISSING_POLICY" }],
		});
		field.runtime.dispose();
	});

	it("rejects executable, accessor, symbol, non-finite and unsafe-prototype inputs without invoking getters", () => {
		const field = installedField();
		const getter = vi.fn(() => "name");
		const accessor = { ...field.candidate, root: Object.defineProperty({}, "id", { get: getter, enumerable: true }) };
		const unsafe = Object.assign(Object.create({ inherited: true }), field.candidate);
		for (const input of [
			accessor,
			unsafe,
			{ ...field.candidate, extra: () => true },
			{ ...field.candidate, extra: Symbol("x") },
			{ ...field.candidate, extra: Number.NaN },
		]) {
			expect(field.admit(input)).toMatchObject({ ok: false, diagnostics: [{ path: [], message: "INVALID_JSON" }] });
		}
		expect(getter).not.toHaveBeenCalled();
		field.runtime.dispose();
	});
});
