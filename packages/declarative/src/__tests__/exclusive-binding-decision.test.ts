import { expect, it } from "vitest";
import { installedField } from "./kalada-runtime-fixtures.js";

it("#376 rejects omit-inactive ownership rather than presenting it as host submission (#408 RE-AUTHOR)", () => {
	const { runtime, admit, candidate } = installedField();
	const result = admit({ ...candidate, submission: { hiddenValues: "omit-inactive" } });
	expect(result).toMatchObject({ ok: false, diagnostics: [{ path: ["submission", "hiddenValues"] }] });
	runtime.dispose();
});
