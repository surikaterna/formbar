import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertRootIsolation, inspectRootGraph } from "../../tests/root-isolation.mjs";

const rootEntry = fileURLToPath(new URL("../index.ts", import.meta.url));
const readWorkspaceSource = (path: string) => readFile(path, "utf8");

function fixture(files: Readonly<Record<string, string>>) {
	return (path: string): Promise<string> => {
		const source = files[path];
		return source === undefined ? Promise.reject(new Error(`Missing fixture ${path}`)) : Promise.resolve(source);
	};
}

describe("root dependency graph isolation", () => {
	it("accepts the complete production root graph", async () => {
		await expect(assertRootIsolation(rootEntry, readWorkspaceSource)).resolves.toBeUndefined();
	});

	it("rejects a bare Node builtin edge", async () => {
		const read = fixture({ "/root.ts": 'import "fs";' });
		expect(await inspectRootGraph("/root.ts", read)).toContain("/root.ts: Node builtin fs");
	});

	it("rejects dynamic import and require builtin edges", async () => {
		const read = fixture({ "/root.ts": 'import("fs/promises"); require("path");' });
		const violations = await inspectRootGraph("/root.ts", read);
		expect(violations).toContain("/root.ts: Node builtin fs/promises");
		expect(violations).toContain("/root.ts: Node builtin path");
	});

	it("rejects computed global process access", async () => {
		const read = fixture({ "/root.ts": 'process["stdout"].write("unsafe");' });
		expect(await inspectRootGraph("/root.ts", read)).toContain("/root.ts: global process reference");
	});

	it("rejects process access through unshadowed global objects", async () => {
		const read = fixture({
			"/root.ts": 'globalThis.process; globalThis["process"]; global.process; global["process"];',
		});
		expect(await inspectRootGraph("/root.ts", read)).toContain("/root.ts: global process reference");
	});

	it("fails closed on non-literal dynamic import and require", async () => {
		const read = fixture({ "/root.ts": "import(target); require(getModule());" });
		const violations = await inspectRootGraph("/root.ts", read);
		expect(violations).toContain("/root.ts: non-literal dynamic import");
		expect(violations).toContain("/root.ts: non-literal require");
	});

	it("rejects Node and process access in a transitive relative module", async () => {
		const read = fixture({
			"/root.ts": 'export * from "./nested.js";',
			"/nested.ts": 'import fs from "node:fs"; process["stdout"].write(String(fs));',
		});
		const violations = await inspectRootGraph("/root.ts", read);
		expect(violations).toContain("/nested.ts: Node builtin node:fs");
		expect(violations).toContain("/nested.ts: global process reference");
	});

	it("allows property names, strings, and a locally shadowed process", async () => {
		const read = fixture({
			"/root.ts": 'function local(process: { stdout: string }) { return { process: process["stdout"] }; }',
		});
		await expect(assertRootIsolation("/root.ts", read)).resolves.toBeUndefined();
	});

	it("allows ordinary process properties and shadowed global objects", async () => {
		const read = fixture({
			"/root.ts":
				'const object = { process: "safe" }; object.process; function local(globalThis: any, global: any) { return [globalThis.process, global["process"]]; }',
		});
		await expect(assertRootIsolation("/root.ts", read)).resolves.toBeUndefined();
	});

	it("rejects a dependency edge to standalone", async () => {
		const read = fixture({
			"/root.ts": 'export * from "./standalone.js";',
			"/standalone.ts": "export type Host = {};",
		});
		expect(await inspectRootGraph("/root.ts", read)).toContain("/root.ts: standalone dependency ./standalone.js");
	});
});
