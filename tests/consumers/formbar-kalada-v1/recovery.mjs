import { JSDOM } from "jsdom";
import * as React from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.window.document,
	HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
});
const { runRecovery, runRecoveryHydration } = await import("./recovery-case.mjs");
for (const type of ["field", "custom"]) {
	await runRecovery(type);
	await runRecoveryHydration(type);
}
dom.window.close();
console.log(
	`PACKED_SEMANTIC_RECOVERY React ${React.version}: widget/custom unchanged failure/no retry, corrected props/value/binding/renderer/implementation, failed channel revocation, committed writes, cleanup, StrictMode SSR/hydration no precommit grant passed`,
);
