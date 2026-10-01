import type { KaladaV1Snapshot } from "@formbar/declarative";
// @vitest-environment jsdom
import { expect, it } from "vitest";
import { indexKaladaView } from "../../../../packages/react-schema/src/kalada-view-index";
import {
	runDuplicateFocus,
	runFocus,
	runLateFocus,
	runMissingViewKeys,
	runNestedDuplicateFocus,
	runScaling,
} from "../../../../tests/consumers/formbar-kalada-v1/repeater-case.mjs";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it.each([100, 200, 500])(
	"R16 installed SSR %s x 5 has exact linear lookup and existing writer-proof capture counts",
	(rows) => {
		runScaling(rows);
		runScaling(rows, true);
	},
);
it.each([
	{},
	{ nested: true },
	{ duplicate: true },
	{ values: ["only"] },
	{ values: ["only"], disabled: true },
	{ values: ["only"], append: false },
])("R17 concrete lexical scope focus %#", runFocus);
it("R17 clicked same-binding duplicate scope owns append fallback and inserted focus", runDuplicateFocus);
it("R17 nested duplicate focus retains clicked parent token across outer reorder", runNestedDuplicateFocus);
it("R16 installed view rejects missing expected control and output keys", runMissingViewKeys);
it.each(["unmount", "dispose", "stale"] as const)(
	"R17 %s delayed atomic action result cannot steal focus",
	runLateFocus,
);
it("R16 refuses duplicate keys instead of silently selecting an arbitrary control/output", () => {
	for (const kind of ["controls", "outputs"] as const) {
		const view = {
			controls: [],
			outputs: [],
			[kind]: [{ key: "duplicate" }, { key: "duplicate" }],
		} as unknown as KaladaV1Snapshot;
		expect(() => indexKaladaView(view)).toThrow(`duplicate: DUPLICATE_${kind === "controls" ? "CONTROL" : "OUTPUT"}`);
	}
});
