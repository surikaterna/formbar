import { expect, it } from "vitest";
import { installedField } from "./kalada-runtime-fixtures.js";

it("#376 rejects old contextual lifecycle predicates at the exact visible slot (#408 RE-AUTHOR)", () => {
	const { runtime, admit, candidate } = installedField();
	const result = admit({
		...candidate,
		root: {
			...candidate.root,
			visible: { kind: "ref", ref: { namespace: "field", segments: ["source", "dirty"] } },
		},
	});
	expect(result).toMatchObject({ ok: false, diagnostics: [{ path: ["root", "visible"], message: "RE-AUTHOR" }] });
	runtime.dispose();
});
