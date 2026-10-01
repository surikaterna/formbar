import { expect, it } from "vitest";
import { disposeDemoSession, installDemo, installDemoSession } from "../runtime/kalada-demo-install";

const document = {
	version: 2 as const,
	schema: {
		type: "object",
		additionalProperties: false,
		properties: {
			groups: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					properties: { values: { type: "array", items: { type: "string" } } },
				},
			},
		},
	},
	definition: null,
	initialData: { groups: [{ values: ["first", "second"] }, { values: ["other"] }] },
};

it("writes a nested primitive row and rejects stale, wrong-type and revoked callbacks without mutation", () => {
	const host = installDemo(document);
	const isolated = installDemo(document);
	try {
		const before = host.snapshot();
		const writer = before.controls.find((control) => control.value === "first")?.writers.value;
		expect(writer).toBeDefined();
		expect(writer?.("edited")).toEqual({ status: "applied" });
		const after = host.snapshot();
		expect(after.data).toEqual({ groups: [{ values: ["edited", "second"] }, { values: ["other"] }] });
		expect(after.rows.map((row) => row.key)).toEqual(before.rows.map((row) => row.key));
		expect(writer?.("stale").status).not.toBe("applied");
		const fresh = after.controls.find((control) => control.value === "edited")?.writers.value;
		const revision = host.currentRevision();
		expect(fresh?.(42).status).not.toBe("applied");
		expect(host.currentRevision()).toBe(revision);
		expect(host.snapshot().data).toEqual(after.data);
		expect(isolated.snapshot().data).toEqual(document.initialData);
		disposeDemoSession(host);
		const replacement = installDemoSession(document, undefined, ["formbar.standard.v1"], host);
		try {
			expect(fresh?.("revoked").status).not.toBe("applied");
			expect(replacement.snapshot().data).toEqual(after.data);
		} finally {
			disposeDemoSession(replacement);
		}
	} finally {
		disposeDemoSession(host);
		disposeDemoSession(isolated);
	}
});
