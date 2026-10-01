// @vitest-environment jsdom
import { expect, it } from "vitest";
import {
	runProfileReinstall,
	runPropertyPolicies,
	runRequiredAuthority,
	runSections,
} from "../../../../tests/consumers/formbar-kalada-v1/sections-case.mjs";
import { sectionsFixture } from "../../../../tests/consumers/formbar-kalada-v1/sections-fixture";
import { arbiterSectionsRules } from "../demos/21-arbiter-dynamic-sections";
import { createDemoArbiter } from "../runtime/kalada-demo-arbiter";
import { managedFieldPolicies, managedPolicyUi } from "../runtime/kalada-demo-managed-policy";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it("R18 real demo21 Auto Home Life Clear required-only rules never manage visibility", () =>
	runSections(sectionsFixture));
it("R18 real demo21 schema and FINAL trusted validation stay independent from native required", () =>
	runRequiredAuthority(sectionsFixture));
it("R18 required disabled/readOnly management is independent and missing required cues refuse", () =>
	runPropertyPolicies(sectionsFixture));
it("R18 trusted profile reinstall retains data and denies stale callbacks", () => runProfileReinstall(sectionsFixture));

it("R18 required-only projection resets selected cues on Clear without introducing visible/disabled/readOnly management", () => {
	const managed = managedFieldPolicies(arbiterSectionsRules);
	const arbiter = createDemoArbiter(arbiterSectionsRules, managedPolicyUi(managed));
	try {
		for (const coverageType of ["auto", "home", "life", null]) {
			arbiter.update({ coverageType });
			expect(arbiter.read(["fieldRequired:make"])).toBe(coverageType === "auto");
			expect(arbiter.read(["fieldRequired:address"])).toBe(coverageType === "home");
			expect(arbiter.read(["fieldRequired:smoker"])).toBe(coverageType === "life");
			for (const key of ["fieldVisible:make", "fieldDisabled:make", "fieldReadOnly:make"])
				expect(arbiter.read([key])).toBeUndefined();
		}
	} finally {
		arbiter.dispose();
	}
});

it("R18 managed properties follow the trusted directive path, not its storage alias", () => {
	const managed = managedFieldPolicies([
		{
			name: "alias",
			when: { coverageType: "auto" },
			// biome-ignore lint/suspicious/noThenProperty: Serialized trusted Arbiter rule data.
			then: [{ $set: { "$formbar.fieldPolicy.alias": { path: "/make", required: true } } }],
		},
	]);
	expect([...managed.required]).toEqual(["make"]);
	for (const property of ["visible", "disabled", "readOnly"] as const) expect(managed[property].size).toBe(0);
	expect(managedPolicyUi(managed)).toEqual({ "fieldRequired:make": false });
});
