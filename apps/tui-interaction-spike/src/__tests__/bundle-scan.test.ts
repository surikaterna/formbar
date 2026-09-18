import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanBundle } from "../../scripts/bundle-scan.mjs";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function scan(source: string, extras: Record<string, string> = {}) {
	const root = mkdtempSync(join(tmpdir(), "formbar-bundle-scan-"));
	roots.push(root);
	writeFileSync(join(root, "index.js"), source);
	for (const [name, content] of Object.entries(extras)) {
		mkdirSync(join(root, name, ".."), { recursive: true });
		writeFileSync(join(root, name), content);
	}
	return scanBundle(root).findings;
}

describe("fail-closed bundle edge scanner", () => {
	it.each([
		['import "node:fs";', "side-effect import"],
		['import value from /* spacing */ "fs";', "import-from"],
		['export * from "node:path";', "re-export"],
		['import("node:os");', "literal dynamic import"],
		['const target = "./chunk.js"; import(target);', "nonliteral dynamic import"],
		['require /* comment */ ("stream");', "commented require"],
		['const target = "./chunk.js"; require(target);', "nonliteral require"],
		['import "./missing.js";', "unresolved relative import"],
		['const marker = "__vite-browser-external";', "browser external marker"],
	])("rejects %s (%s)", (source) => {
		expect(scan(source)).not.toEqual([]);
	});

	it("independently rejects invalid JavaScript syntax", () => {
		expect(scan("export {;").some((finding) => finding.includes("syntax validation failed"))).toBe(true);
	});

	it("accepts fully resolved literal module edges", () => {
		expect(
			scan('export { value } from "./chunk.js"; import("./chunk.js");', { "chunk.js": "export const value = 1;" }),
		).toEqual([]);
	});
});
