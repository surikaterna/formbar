import { JSDOM } from "jsdom";
import * as React from "react";
const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.window.document,
	HTMLElement: dom.window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
});
const { runScaling, runFocus, runDuplicateFocus, runLateFocus, runMissingViewKeys, runNestedDuplicateFocus } =
	await import("./repeater-case.mjs");
for (const rows of [100, 200, 500]) {
	runScaling(rows);
	runScaling(rows, true);
}
for (const options of [
	{},
	{ nested: true },
	{ duplicate: true },
	{ values: ["only"] },
	{ values: ["only"], disabled: true },
	{ values: ["only"], append: false },
])
	await runFocus(options);
await runDuplicateFocus();
runMissingViewKeys();
await runNestedDuplicateFocus();
for (const mode of ["unmount", "dispose", "stale"]) await runLateFocus(mode);
dom.window.close();
console.log(
	`PACKED_REPEATER_PARITY React ${React.version}: linear installed SSR100/200/500x5 controls/outputs, append/insert/remove/next/move/swap/denial/disabled fallback/nested/duplicate binding focus passed`,
);
