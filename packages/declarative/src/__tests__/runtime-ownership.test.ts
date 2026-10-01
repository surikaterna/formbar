import { expect, it } from "vitest";
import { installedField } from "./kalada-runtime-fixtures.js";

it("#376 cannot accept old positional scoped field ownership as a direct write proof (#408 RE-AUTHOR)", () => {
	const { runtime, admit, candidate } = installedField();
	const result = admit({
		...candidate,
		root: {
			...candidate.root,
			binding: { namespace: "data", segments: ["rows", 0, "name"] },
		},
	});
	expect(result).toMatchObject({ ok: false, diagnostics: [{ path: ["root", "binding"] }] });
	runtime.dispose();
});
