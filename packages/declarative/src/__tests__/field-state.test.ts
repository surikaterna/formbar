import { describe, expect, it } from "vitest";
import { installedField, program } from "./kalada-runtime-fixtures.js";

describe("installed field flags", () => {
	it("defaults to visible and editable, with required false and a host-backed value", () => {
		const { runtime } = installedField();
		expect(runtime.snapshot().controls[0]).toMatchObject({
			nodeId: "name",
			value: "original",
			visible: true,
			disabled: false,
			readOnly: false,
			required: false,
		});
		runtime.dispose();
	});

	it("projects required Boolean and denies a writer when disabled", () => {
		const { runtime } = installedField({
			disabled: program({ kind: "literal", value: true }),
			required: program({ kind: "literal", value: true }),
		});
		expect(runtime.snapshot().controls[0]).toMatchObject({ disabled: true, required: true, writers: {} });
		runtime.dispose();
	});

	it.each([null, "true", 1])("denies non-Boolean required value %j at its slot", (value) => {
		const field = installedField({ required: program({ kind: "literal", value }) });
		expect(() => field.runtime.snapshot()).toThrow("root.required: BOOLEAN_REQUIRED");
		field.runtime.dispose();
	});

	it("does not coerce null visible to false", () => {
		const field = installedField({ visible: program({ kind: "literal", value: null }) });
		expect(() => field.runtime.snapshot()).toThrow("root.visible: BOOLEAN_REQUIRED");
		field.runtime.dispose();
	});

	it("denies old lifecycle references at the precise expression path (#408)", () => {
		const field = installedField();
		expect(
			field.admit({
				...field.candidate,
				root: {
					...field.candidate.root,
					required: { kind: "ref", ref: { namespace: "form", segments: ["submitted"] } },
				},
			}),
		).toMatchObject({
			ok: false,
			diagnostics: [{ path: ["root", "required"], message: "RE-AUTHOR" }],
		});
		field.runtime.dispose();
	});
});
