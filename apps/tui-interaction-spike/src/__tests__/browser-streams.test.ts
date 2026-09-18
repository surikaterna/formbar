import { describe, expect, it } from "vitest";
import { assertInkOutputStream, createBrowserOutputStream, createInkBrowserOptions } from "../browser-streams.js";

describe("Ink browser stream adapter", () => {
	it("validates and adapts every member consumed by Ink", () => {
		const stream = createBrowserOutputStream(() => undefined, 80, 24);
		expect(() => assertInkOutputStream(stream)).not.toThrow();
		const options = createInkBrowserOptions(stream);
		expect(options).toMatchObject({ stdout: stream, stderr: stream, exitOnCtrlC: false, patchConsole: false });
	});

	it.each(["write", "on", "off", "columns", "rows", "isTTY"] as const)("rejects a missing %s member", (member) => {
		const stream = { ...createBrowserOutputStream(() => undefined, 80, 24), [member]: undefined };
		expect(() => assertInkOutputStream(stream)).toThrow(`requires ${member}`);
	});
});
