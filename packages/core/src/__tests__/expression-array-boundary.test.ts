import { createExpressionService } from "@formbar/expressions";
import { describe, expect, it, vi } from "vitest";
import { holeWithProperty, invalidArrayKeys } from "../../../../test/expression-array-fixtures.js";
import { ref } from "../../../../test/expression-fixtures.js";
import { createCoreExpressionNamespaces, createForm } from "../index.js";

describe("R1 rejects malformed authorized writes before core mutation", () => {
	it.each(invalidArrayKeys)("rejects %s without dispatch, state changes or notification", (key) => {
		const form = createForm({ initialData: { x: [1] } });
		const dispatch = vi.spyOn(form, "dispatch");
		const listener = vi.fn();
		form.subscribe(listener);
		const service = createExpressionService({
			namespaces: createCoreExpressionNamespaces(form),
		});
		const program = service.compile(ref("x"));
		if (!program.ok) throw new Error("compile");
		const writable = service.resolveWritable(program.value);
		if (!writable.ok) throw new Error("writable");
		const state = form.getState();
		expect(writable.value(holeWithProperty(key) as never).ok).toBe(false);
		expect(form.getState()).toBe(state);
		expect(form.getState().data.x).toEqual([1]);
		expect(dispatch).not.toHaveBeenCalled();
		expect(listener).not.toHaveBeenCalled();
		service.dispose();
		form.dispose();
	});
});
