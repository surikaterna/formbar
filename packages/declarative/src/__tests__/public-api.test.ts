import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createFormRuntime, validateFormDefinition } from "../index.js";

const root = new URL("../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const stableVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const caretStableRange = /^\^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const neutralDependencyManifests = {
	"@formbar/core": "packages/core/package.json",
	"@formbar/expressions": "packages/expressions/package.json",
} as const;
type NeutralDependency = keyof typeof neutralDependencyManifests;
type NeutralVersions = Record<NeutralDependency, string>;

describe("public package boundary", () => {
	it("exports validation without owning expression language behavior", () => {
		expect(typeof validateFormDefinition).toBe("function");
		expect(typeof createFormRuntime).toBe("function");
		const sources = readdirSync(new URL("packages/declarative/src/", root), { recursive: true })
			.filter((path) => String(path).endsWith(".ts") && !String(path).includes("__tests__"))
			.map(String);
		for (const source of sources) {
			const contents = read(`packages/declarative/src/${source}`);
			expect(contents).not.toMatch(
				/from ["'](?:react|@formbar\/arbiter|@arbitre|@scheman|@formbar\/from-schema|[^"']*descriptors|kuery)/,
			);
			expect(contents).not.toMatch(/eval\s*\(|new Function/);
		}
	});

	it("keeps production files and functions within the code-principle limits", () => {
		const sources = readdirSync(new URL("packages/declarative/src/", root), { recursive: true })
			.filter((path) => String(path).endsWith(".ts") && !String(path).includes("__tests__"))
			.map(String);
		for (const source of sources) checkSource(source);
	});

	it("declares a public source-free package with only neutral framework dependencies", () => {
		const manifest = JSON.parse(read("packages/declarative/package.json"));
		expect(manifest.files).toEqual(["dist"]);
		expectNeutralDependencies(manifest.dependencies, readNeutralVersions());
		expect(manifest.exports["."]).toEqual({
			types: "./dist/index.d.ts",
			import: "./dist/index.js",
			require: "./dist/index.cjs",
		});
	});

	it("accepts a Changesets-style linked dependency range bump", () => {
		expectNeutralDependencies(
			{ "@formbar/core": "^0.7.0", "@formbar/expressions": "^0.4.0" },
			{ "@formbar/core": "0.7.0", "@formbar/expressions": "0.4.0" },
		);
	});

	it("rejects unexpected dependencies and invalid or incompatible ranges", () => {
		const versions: NeutralVersions = { "@formbar/core": "0.7.0", "@formbar/expressions": "0.4.0" };
		const dependencies = { "@formbar/core": "^0.7.0", "@formbar/expressions": "^0.4.0" };
		expect(() => expectNeutralDependencies({ ...dependencies, react: "^19.0.0" }, versions)).toThrow();
		for (const range of ["0.7.0", "^0.7", "^0.6.0"]) {
			expect(() => expectNeutralDependencies({ ...dependencies, "@formbar/core": range }, versions)).toThrow();
		}
	});
});

function readNeutralVersions(): NeutralVersions {
	return Object.fromEntries(
		Object.entries(neutralDependencyManifests).map(([name, path]) => [name, JSON.parse(read(path)).version]),
	) as NeutralVersions;
}

function expectNeutralDependencies(dependencies: Record<string, string>, versions: NeutralVersions): void {
	const names = Object.keys(neutralDependencyManifests) as NeutralDependency[];
	expect(Object.keys(dependencies).sort()).toEqual([...names].sort());
	for (const name of names) {
		const version = versions[name];
		expect(version, `${name} package version`).toMatch(stableVersion);
		expect(dependencies[name], `${name} dependency range`).toMatch(caretStableRange);
		expect(dependencies[name], `${name} compatible dependency range`).toBe(`^${version}`);
	}
}

function checkSource(source: string): void {
	const contents = read(`packages/declarative/src/${source}`);
	expect(contents.split("\n").length, source).toBeLessThanOrEqual(400);
	const tree = ts.createSourceFile(
		fileURLToPath(new URL(`packages/declarative/src/${source}`, root)),
		contents,
		ts.ScriptTarget.Latest,
		true,
	);
	expect(nesting(tree), `${source}:control-flow nesting`).toBeLessThanOrEqual(3);
	const visit = (node: ts.Node): void => {
		if (ts.isFunctionLike(node) && "body" in node && node.body) {
			const start = tree.getLineAndCharacterOfPosition(node.getStart()).line;
			const end = tree.getLineAndCharacterOfPosition(node.end).line;
			expect(end - start + 1, `${source}:${start + 1}`).toBeLessThan(50);
		}
		ts.forEachChild(node, visit);
	};
	visit(tree);
}

function nesting(node: ts.Node, depth = 0): number {
	const control =
		ts.isIfStatement(node) ||
		ts.isForStatement(node) ||
		ts.isForOfStatement(node) ||
		ts.isForInStatement(node) ||
		ts.isWhileStatement(node) ||
		ts.isDoStatement(node) ||
		ts.isSwitchStatement(node) ||
		ts.isConditionalExpression(node) ||
		ts.isTryStatement(node);
	const next = ts.isFunctionLike(node) ? 0 : depth + Number(control);
	let maximum = next;
	ts.forEachChild(node, (child) => {
		maximum = Math.max(maximum, nesting(child, next));
	});
	return maximum;
}
