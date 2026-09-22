import { describe, expect, it } from "vitest";
import { createForm } from "../index.js";

describe("form state capture", () => {
	it("exposes only snapshot-bound dirty queries and keeps baselines private", () => {
		const form = createForm({
			initialData: { profile: { name: "Ada" }, $ui: { value: false } },
			initialUiState: { panel: { open: false } },
		});
		const capture = form.captureState();
		expect(Object.keys(capture).sort()).toEqual(["isFieldDirty", "isFormDirty", "state"]);
		expect("initialData" in capture).toBe(false);
		expect("initialUiState" in capture).toBe(false);
		expect(Reflect.set(capture, "initialData", { profile: { name: "Grace" } })).toBe(false);
		// @ts-expect-error Baseline objects are intentionally absent from the public capture.
		expect(capture.initialData).toBeUndefined();
		// @ts-expect-error Baseline objects are intentionally absent from the public capture.
		expect(capture.initialUiState).toBeUndefined();

		form.reset();
		expect(form.getState()).toMatchObject({
			data: { profile: { name: "Ada" }, $ui: { value: false } },
			uiState: { panel: { open: false } },
		});
	});

	it("keeps retained queries coherent across nested writes, restores, and reset rebinding", () => {
		const form = createForm({
			initialData: { profile: { name: "Ada" }, $ui: { value: false } },
			initialUiState: { panel: { open: false } },
		});
		const initial = form.captureState();
		const profile = { namespace: "data", segments: ["profile", "name"] } as const;
		const literalUi = { namespace: "data", segments: ["$ui", "value"] } as const;
		const actualUi = { namespace: "ui", segments: ["panel", "open"] } as const;

		form.setValue("profile.name", "Grace");
		form.setValue("/$ui/value" as never, true as never);
		form.setValue("$ui.panel.open" as never, true as never);
		const changed = form.captureState();
		expect(initial.isFormDirty()).toBe(false);
		expect([initial.isFieldDirty(profile), initial.isFieldDirty(literalUi), initial.isFieldDirty(actualUi)]).toEqual([
			false,
			false,
			false,
		]);
		expect(changed.isFormDirty()).toBe(true);
		expect([changed.isFieldDirty(profile), changed.isFieldDirty(literalUi), changed.isFieldDirty(actualUi)]).toEqual([
			true,
			true,
			true,
		]);

		form.setValue("profile.name", "Ada");
		form.setValue("/$ui/value" as never, false as never);
		form.setValue("$ui.panel.open" as never, false as never);
		const restored = form.captureState();
		expect(restored.isFormDirty()).toBe(false);
		expect([restored.isFieldDirty(profile), restored.isFieldDirty(literalUi), restored.isFieldDirty(actualUi)]).toEqual(
			[false, false, false],
		);
		expect(changed.isFormDirty()).toBe(true);

		form.reset({
			data: { profile: { name: "Lin" }, $ui: { value: true } },
			uiState: { panel: { open: true } },
		});
		const rebound = form.captureState();
		expect(rebound.isFormDirty()).toBe(false);
		expect([rebound.isFieldDirty(profile), rebound.isFieldDirty(literalUi), rebound.isFieldDirty(actualUi)]).toEqual([
			false,
			false,
			false,
		]);
		expect(initial.isFormDirty()).toBe(false);
		expect(changed.isFormDirty()).toBe(true);
		form.reset();
		expect(form.getState()).toMatchObject({
			data: { profile: { name: "Lin" }, $ui: { value: true } },
			uiState: { panel: { open: true } },
		});
	});
});
