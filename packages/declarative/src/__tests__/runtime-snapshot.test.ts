import type { ValidationIssue } from "@formbar/core";
import { describe, expect, it } from "vitest";
import { createFormRuntime } from "../index.js";
import { definition, field, literal, runtime, runtimeRef } from "./runtime-fixtures.js";

describe("declarative runtime snapshots", () => {
	it("projects six coherent form flags and exact field lifecycle/issues", async () => {
		const issue: ValidationIssue = {
			code: "name",
			message: "Name is required",
			severity: "error",
			path: { namespace: "data", segments: ["name"], format: "dot" },
			source: { origin: "function-validator", validatorId: "required" },
		};
		const formDefinition = definition([
			field("name", ["name"], { required: runtimeRef("form", ["dirty"]) }),
			field("other", ["other"]),
		]);
		const { form, runtime: port } = runtime(formDefinition, {
			initialData: { name: "Ada", other: "x" },
			validators: [({ data }) => ((data as { name: string }).name ? [] : [issue])],
		});
		expect(port.getSnapshot().form).toEqual({
			valid: true,
			validating: false,
			submitting: false,
			dirty: false,
			touched: false,
			submitted: false,
		});
		form.setValue("name", "");
		form.field("name").markTouched();
		const changed = port.getSnapshot();
		expect(changed.form).toMatchObject({ valid: false, dirty: true, touched: true });
		expect(changed.fields.find((item) => item.instance.nodeId === "name")).toMatchObject({
			value: "",
			valid: false,
			dirty: true,
			touched: true,
			required: true,
			issues: [issue],
		});
		await form.submit();
		expect(port.getSnapshot().form.submitted).toBe(true);
	});

	it("keeps hidden data and core submit validation authoritative", async () => {
		const formDefinition = definition([
			field("secret", ["secret"], { visible: literal(false), required: literal(true) }),
		]);
		const { form, runtime: port } = runtime(formDefinition, { initialData: { secret: "kept" } });
		expect(port.getSnapshot().fields[0]).toMatchObject({ visible: false, value: "kept", required: true });
		expect((await form.submit()).ok).toBe(true);
		expect(form.getState().data).toEqual({ secret: "kept" });
	});

	it("routes reads and writes through existing core expression capabilities", () => {
		const formDefinition = definition([field("name", ["name"])]);
		const { form, runtime: port } = runtime(formDefinition, { initialData: { name: "before" } });
		expect(port.read({ namespace: "data", segments: ["name"] })).toBe("before");
		expect(port.write("data", ["name"], "after")).toEqual({ ok: true });
		expect(form.getState().data.name).toBe("after");
		port.dispose();
		expect(port.write("data", ["name"], "ignored")).toMatchObject({ ok: false });
	});

	it("exposes every form lifecycle reference from the runtime status", () => {
		const expected = {
			valid: true,
			validating: false,
			submitting: false,
			dirty: false,
			touched: false,
			submitted: false,
		};
		const fields = Object.entries(expected).map(([key, value]) =>
			field(key, [key], {
				visible: value ? runtimeRef("form", [key]) : { kind: "op", op: "not", args: [runtimeRef("form", [key])] },
			}),
		);
		const { runtime: port } = runtime(definition(fields), { initialData: expected });
		expect(port.getSnapshot().fields.map((item) => item.visible)).toEqual([true, true, true, true, true, true]);
	});

	it("diagnoses invalid and duplicate baselines without partial overrides", () => {
		const formDefinition = definition([field("name", ["name"])]);
		const { form } = runtime(formDefinition, { initialData: { name: "Ada" } });
		const port = createFormRuntime({
			form,
			definition: formDefinition,
			baseline: [
				{ nodeId: "name", required: true, label: "First" },
				{ nodeId: "name", label: "Second" },
				{ nodeId: "missing", required: true },
			],
		});
		const snapshot = port.getSnapshot();
		expect(snapshot.fields[0]).toMatchObject({ required: false, label: "/name" });
		expect(snapshot.diagnostics.map((item) => item.code)).toEqual(["invalid-baseline", "duplicate-baseline"]);
	});
});
