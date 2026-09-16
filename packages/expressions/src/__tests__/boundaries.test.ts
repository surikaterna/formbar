import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = new URL("../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const manifest = (name: string) => JSON.parse(read(`packages/${name}/package.json`));

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
const newFiles = [
	...readdirSync(new URL("packages/expressions/src/", root))
		.filter((name) => name.endsWith(".ts"))
		.map((name) => `packages/expressions/src/${name}`),
	"packages/core/src/disposal-signal.ts",
	"packages/core/src/form-disposer.ts",
	"packages/core/src/expression-namespaces.ts",
	"packages/core/src/immutable-path.ts",
	"packages/react/src/use-expression-props.ts",
	"packages/arbiter/src/expression-then-operator.ts",
];

describe("expression ownership and source principles", () => {
	it("uses the released Kuery runtime and keeps integrations decoupled", () => {
		expect(manifest("expressions").dependencies.kuery).toBe("^2.1.0");
		expect(read("packages/expressions/tsup.config.ts")).not.toContain("noExternal");
		for (const name of ["core", "react", "arbiter"]) {
			expect(manifest(name).dependencies["@formbar/expressions"]).toBeDefined();
			expect(manifest(name).dependencies["@formbar/expressions-kuery"]).toBeUndefined();
		}
	});
	it("declares a separately consumable public build and coordinated initial release", () => {
		const linked = JSON.parse(read(".changeset/config.json")).linked.flat();
		for (const name of ["expressions"]) {
			const pkg = manifest(name);
			expect(pkg.exports["."]).toEqual({
				types: "./dist/index.d.ts",
				import: "./dist/index.js",
				require: "./dist/index.cjs",
			});
			expect(linked).toContain(pkg.name);
			expect(read(".changeset/shared-expression-runtime.md")).toContain(`"${pkg.name}": minor`);
		}
	});
	it("packs only public expression artifacts and documentation", () => {
		const output = execFileSync("npm", ["pack", "--dry-run", "--json", "./packages/expressions"], {
			cwd: fileURLToPath(root),
			encoding: "utf8",
		});
		const files = JSON.parse(output)[0].files.map(({ path }: { path: string }) => path);
		expect(manifest("expressions").files).toEqual(["dist", "docs"]);
		expect(files).toEqual(
			expect.arrayContaining([
				"dist/index.js",
				"dist/index.cjs",
				"dist/index.d.ts",
				"dist/index.d.cts",
				"docs/adr/0001-expression-service-and-reactive-props.md",
			]),
		);
		expect(files).not.toContain(expect.stringMatching(/(^|\/)(src|__tests__|test|scripts|node_modules)(\/|\.|$)/));
		expect(files).not.toContain(expect.stringMatching(/(^|\/)tsconfig|(^|\/)tsup\.config/));
	});
	it.each(newFiles)("keeps %s cohesive and bounded without private imports", (path) => {
		const source = read(path);
		expect(source.split("\n").length).toBeLessThanOrEqual(400);
		expect(source).not.toMatch(/from ["'](?:kuery\/(?!expression)|@arbitre\/core)\//);
		const tree = ts.createSourceFile(fileURLToPath(new URL(path, root)), source, ts.ScriptTarget.Latest, true);
		expect(nesting(tree), `${path}: control-flow nesting`).toBeLessThanOrEqual(3);
		const visit = (node: ts.Node): void => {
			if (ts.isFunctionLike(node) && "body" in node && node.body) {
				const start = tree.getLineAndCharacterOfPosition(node.getStart()).line;
				const end = tree.getLineAndCharacterOfPosition(node.end).line;
				expect(end - start + 1, `${path}: ${node.name?.getText() ?? start + 1}`).toBeLessThan(50);
			}
			ts.forEachChild(node, visit);
		};
		visit(tree);
	});
});
