import type { ProductionRule } from "@arbitre/core";
import { createForm } from "@formbar/core";
import { describe, expect, test } from "vitest";
import { createArbiterPlugin } from "../arbiter-plugin.js";

/**
 * Reproduction test for demo 18 (arbiter visibility).
 * Uses the same country transitions as the historical demo while expressing
 * visibility through normalized field policy.
 */

interface FormData {
	readonly country: string;
	readonly state: string;
	readonly province: string;
	readonly region: string;
}

const arbiterRules: readonly ProductionRule[] = [
	{
		name: "showUSState",
		when: { country: "US" },
		then: [
			{
				$set: {
					"$formbar.fieldPolicy.state": { path: "/state", visible: true },
					"$formbar.fieldPolicy.province": { path: "/province", visible: false },
				},
			},
		],
	},
	{
		name: "showCAProvince",
		when: { country: "CA" },
		then: [
			{
				$set: {
					"$formbar.fieldPolicy.state": { path: "/state", visible: false },
					"$formbar.fieldPolicy.province": { path: "/province", visible: true },
				},
			},
		],
	},
	{
		name: "hideRegional",
		when: { country: { $nin: ["US", "CA"] } },
		then: [
			{
				$set: {
					"$formbar.fieldPolicy.state": { path: "/state", visible: false },
					"$formbar.fieldPolicy.province": { path: "/province", visible: false },
				},
			},
		],
	},
];

function makeForm() {
	return createForm<FormData, object>({
		initialData: { country: "", state: "", province: "", region: "" },
		initialUiState: {},
		plugins: [createArbiterPlugin({ rules: arbiterRules })],
	});
}

function visibility(form: ReturnType<typeof makeForm>) {
	return Object.fromEntries(
		form.getState().fieldPolicy.map((item) => [String(item.path.segments[0]), item.visible]),
	) as { state: boolean; province: boolean };
}

describe("demo 18 arbiter visibility — direct state", () => {
	test("initial state: both hidden", () => {
		const form = makeForm();
		form.setValue("country", "");
		expect(visibility(form)).toEqual({ province: false, state: false });
		form.dispose();
	});

	test("select US: showState=true, showProvince=false", () => {
		const form = makeForm();
		form.setValue("country", "US");
		expect(visibility(form)).toEqual({ province: false, state: true });
		form.dispose();
	});

	test("switch US → CA: showState=false, showProvince=true", () => {
		const form = makeForm();
		form.setValue("country", "US");
		form.setValue("country", "CA");
		expect(visibility(form)).toEqual({ province: true, state: false });
		form.dispose();
	});

	test("switch CA → UK: both hidden", () => {
		const form = makeForm();
		form.setValue("country", "US");
		form.setValue("country", "CA");
		form.setValue("country", "UK");
		expect(visibility(form)).toEqual({ province: false, state: false });
		form.dispose();
	});

	test("switch UK → US: showState=true again", () => {
		const form = makeForm();
		form.setValue("country", "US");
		form.setValue("country", "CA");
		form.setValue("country", "UK");
		form.setValue("country", "US");
		expect(visibility(form)).toEqual({ province: false, state: true });
		form.dispose();
	});

	test("select empty string: both hidden", () => {
		const form = makeForm();
		form.setValue("country", "US");
		form.setValue("country", "");
		expect(visibility(form)).toEqual({ province: false, state: false });
		form.dispose();
	});
});

describe("demo 18 arbiter visibility — subscription", () => {
	test("subscriber sees correct uiState after each setValue", () => {
		const form = makeForm();
		const snapshots: ReturnType<typeof visibility>[] = [];
		form.subscribe(() => {
			snapshots.push(visibility(form));
		});

		form.setValue("country", "US");
		const afterUS = snapshots[snapshots.length - 1];
		expect(afterUS).toEqual({ province: false, state: true });

		form.setValue("country", "CA");
		const afterCA = snapshots[snapshots.length - 1];
		expect(afterCA).toEqual({ province: true, state: false });

		form.setValue("country", "UK");
		const afterUK = snapshots[snapshots.length - 1];
		expect(afterUK).toEqual({ province: false, state: false });

		form.setValue("country", "US");
		const afterUS2 = snapshots[snapshots.length - 1];
		expect(afterUS2).toEqual({ province: false, state: true });

		form.setValue("country", "");
		const afterEmpty = snapshots[snapshots.length - 1];
		expect(afterEmpty).toEqual({ province: false, state: false });

		form.dispose();
	});

	test("subscriber receives notifications for every transition", () => {
		const form = makeForm();
		let callCount = 0;
		form.subscribe(() => {
			callCount++;
		});

		form.setValue("country", "US");
		form.setValue("country", "CA");
		form.setValue("country", "UK");

		expect(callCount).toBeGreaterThanOrEqual(3);
		form.dispose();
	});
});
