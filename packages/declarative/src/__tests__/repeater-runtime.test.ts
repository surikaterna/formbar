import { expect, it } from "vitest";
import { installedField } from "./kalada-runtime-fixtures.js";

it("#376 rejects Kuery array actions at their authored node (#407 RE-AUTHOR)", () => {
	const { runtime, admit, candidate } = installedField();
	const result = admit({
		...candidate,
		root: {
			type: "action",
			id: "append",
			action: "array.append",
			target: { namespace: "data", segments: ["rows"] },
		},
	});
	expect(result).toMatchObject({
		ok: false,
		diagnostics: [{ path: ["root", "payload"], message: "INVALID_ACTION_PAYLOAD" }],
	});
	runtime.dispose();
});
