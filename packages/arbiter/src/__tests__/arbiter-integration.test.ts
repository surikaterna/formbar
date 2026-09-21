import type { ProductionRule } from "@arbitre/core";
import { createSession } from "@arbitre/core";
import { createForm } from "@formbar/core";
import { describe, expect, test } from "vitest";
import { createArbiterPlugin } from "../arbiter-plugin.js";

describe("createArbiterPlugin", () => {
	test("creates plugin from rules", () => {
		const rules: readonly ProductionRule[] = [
			{
				name: "setTotal",
				when: { qty: { $gt: 0 } },
				then: [{ $set: { "$ui.showTotal": true } }],
			},
		];
		const plugin = createArbiterPlugin({ rules });
		expect(plugin.id).toBe("arbiter");
		expect(plugin.evaluate).toBeInstanceOf(Function);
	});

	test("plugin writes when rules fire via form", () => {
		const rules: readonly ProductionRule[] = [
			{
				name: "showDiscount",
				when: { qty: { $gte: 10 } },
				then: [{ $set: { "$ui.showDiscount": true } }],
			},
		];
		const form = createForm({
			initialData: { qty: 0 },
			plugins: [createArbiterPlugin({ rules })],
		});
		form.setValue("qty", 15);
		expect((form.getState().uiState as Record<string, unknown>).showDiscount).toBe(true);
		form.dispose();
	});

	test("no writes when rules do not fire", () => {
		const rules: readonly ProductionRule[] = [
			{
				name: "showDiscount",
				when: { qty: { $gte: 10 } },
				then: [{ $set: { "$ui.showDiscount": true } }],
			},
		];
		const form = createForm({
			initialData: { qty: 3 },
			plugins: [createArbiterPlugin({ rules })],
		});
		form.setValue("qty", 5);
		expect((form.getState().uiState as Record<string, unknown>).showDiscount).toBeUndefined();
		form.dispose();
	});
});

describe("createArbiterPlugin with pre-configured session", () => {
	test("wraps a pre-configured session", () => {
		const session = createSession({
			rules: [{ name: "r1", when: { x: 1 }, then: [{ $set: { "$ui.y": 2 } }] }],
		});
		const plugin = createArbiterPlugin({ session });
		expect(plugin.id).toBe("arbiter");
	});

	test("filters out arbiter-internal namespace changes", () => {
		const rules: readonly ProductionRule[] = [
			{
				name: "internalWrite",
				when: {},
				then: [
					{ $set: { "$state.counter": 1 } },
					{ $set: { "$ui.visible": true } },
					{ $set: { "$meta.timestamp": 999 } },
					{ $set: { "$contributions.source": "test" } },
					{ $set: { name: "kept" } },
				],
			},
		];
		const form = createForm({
			initialData: { trigger: true, name: "" },
			plugins: [createArbiterPlugin({ rules })],
		});
		form.setValue("trigger", false);
		const state = form.getState();
		// $ui writes should pass through
		expect((state.uiState as Record<string, unknown>).visible).toBe(true);
		// data writes should pass through
		expect((state.data as Record<string, unknown>).name).toBe("kept");
		// $meta remains internal; Arbiter policy production is intentionally deferred.
		expect(state.fieldPolicy).toEqual([]);
		form.dispose();
	});
});

describe("createForm with arbiter plugin", () => {
	test("form with arbiter plugin evaluates on setValue", () => {
		const rules: readonly ProductionRule[] = [
			{
				name: "calcTotal",
				when: {},
				then: [{ $set: { "$ui.evaluated": true } }],
			},
		];
		const form = createForm({
			initialData: { qty: 0 },
			plugins: [createArbiterPlugin({ rules })],
		});
		form.setValue("qty", 5);
		const state = form.getState();
		expect((state.uiState as Record<string, unknown>).evaluated).toBe(true);
		form.dispose();
	});

	test("form without plugins skips expression step", () => {
		const form = createForm({ initialData: { x: 1 } });
		const result = form.setValue("x", 2);
		expect(result.ok).toBe(true);
		expect(form.getState().data).toEqual({ x: 2 });
		form.dispose();
	});

	test("arbiter plugin can write to data namespace", () => {
		const rules: readonly ProductionRule[] = [
			{
				name: "setLabel",
				when: {},
				then: [{ $set: { label: "computed" } }],
			},
		];
		const form = createForm({
			initialData: { name: "test", label: "" },
			plugins: [createArbiterPlugin({ rules })],
		});
		form.setValue("name", "hello");
		expect((form.getState().data as Record<string, unknown>).label).toBe("computed");
		form.dispose();
	});

	test("form with arbiterPlugin from session", () => {
		const session = createSession({
			rules: [{ name: "r1", when: {}, then: [{ $set: { "$ui.ready": true } }] }],
		});
		const form = createForm({
			initialData: { x: 0 },
			plugins: [createArbiterPlugin({ session })],
		});
		form.setValue("x", 1);
		expect((form.getState().uiState as Record<string, unknown>).ready).toBe(true);
		form.dispose();
	});

	test("data writes apply to all fields including user-edited field", () => {
		const rules: readonly ProductionRule[] = [
			{
				name: "resetQty",
				when: {},
				then: [{ $set: { qty: 0 } }],
			},
		];
		const form = createForm({
			initialData: { qty: 0, label: "" },
			plugins: [createArbiterPlugin({ rules })],
		});
		form.setValue("qty", 5);
		// Plugin writes apply unconditionally — filtering is plugin responsibility
		expect((form.getState().data as Record<string, unknown>).qty).toBe(0);
		form.dispose();
	});

	test("arbiter writes to OTHER fields still apply when user edits a field", () => {
		const rules: readonly ProductionRule[] = [
			{
				name: "computeLabel",
				when: {},
				then: [{ $set: { label: "computed" } }],
			},
		];
		const form = createForm({
			initialData: { qty: 0, label: "" },
			plugins: [createArbiterPlugin({ rules })],
		});
		form.setValue("qty", 5);
		expect((form.getState().data as Record<string, unknown>).label).toBe("computed");
		form.dispose();
	});

	test("uiState retracts when rule condition becomes false", () => {
		const rules: readonly ProductionRule[] = [
			{
				name: "showDiscount",
				when: { qty: { $gte: 10 } },
				then: [{ $set: { "$ui.showDiscount": true } }],
			},
		];
		const form = createForm({
			initialData: { qty: 15 },
			plugins: [createArbiterPlugin({ rules })],
		});

		form.setValue("qty", 15);
		expect((form.getState().uiState as Record<string, unknown>).showDiscount).toBe(true);

		form.setValue("qty", 3);
		expect((form.getState().uiState as Record<string, unknown>).showDiscount).toBeUndefined();
		form.dispose();
	});
});
