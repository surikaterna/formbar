import { expect, it } from "vitest";
import { installedField } from "./kalada-runtime-fixtures.js";

it("#376 does not grant old field issue provenance in a V1 lifecycle predicate (#408 RE-AUTHOR)", () => {
	const { runtime, admit, candidate } = installedField();
	const result = admit({
		...candidate,
		root: {
			...candidate.root,
			required: { kind: "ref", ref: { namespace: "field", segments: ["name", "valid"] } },
		},
	});
	expect(result).toMatchObject({ ok: false, diagnostics: [{ path: ["root", "required"], message: "RE-AUTHOR" }] });
	runtime.dispose();
});
