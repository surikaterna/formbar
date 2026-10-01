import { JSDOM } from "jsdom";
import * as React from "react";
const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.window.document,
	HTMLElement: dom.window.HTMLElement,
	HTMLFormElement: dom.window.HTMLFormElement,
	IS_REACT_ACT_ENVIRONMENT: true,
});
const { sectionsFixture } = await import("./sections-fixture.mjs");
const { runSections, runRequiredAuthority, runPropertyPolicies, runProfileReinstall } = await import(
	"./sections-case.mjs"
);
await runSections(sectionsFixture);
await runRequiredAuthority(sectionsFixture);
await runPropertyPolicies(sectionsFixture);
await runProfileReinstall(sectionsFixture);
dom.window.close();
console.log(
	`PACKED_DEMO21_POLICIES React ${React.version}: actual bundled app installer, Auto/Home/Life/Clear visible required/ARIA, draft retention, schema+FINAL independent of browser, disabled/readOnly separation, missing cue refusal, profile replacement stale channels passed`,
);
