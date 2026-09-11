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
	...readdirSync(new URL("packages/expressions-kuery/src/", root))
		.filter((name) => name.endsWith(".ts"))
		.map((name) => `packages/expressions-kuery/src/${name}`),
	"packages/core/src/disposal-signal.ts",
	"packages/core/src/form-disposer.ts",
	"packages/core/src/expression-namespaces.ts",
	"packages/react/src/use-expression-props.ts",
	"packages/arbiter/src/expression-operator.ts",
];

describe("expression ownership and source principles", () => {
	it("keeps the neutral package dependency-free and integrations backend-neutral", () => {
		expect(manifest("expressions").dependencies ?? {}).toEqual({});
		for (const name of ["core", "react", "arbiter"]) {
			expect(manifest(name).dependencies["@formbar/expressions"]).toBeDefined();
			expect(manifest(name).dependencies["@formbar/expressions-kuery"]).toBeUndefined();
		}
		expect(Object.keys(manifest("expressions-kuery").dependencies).sort()).toEqual(["@formbar/expressions", "kuery"]);
	});
	it("declares separately consumable public builds and coordinated initial releases", () => {
		const linked = JSON.parse(read(".changeset/config.json")).linked.flat();
		for (const name of ["expressions", "expressions-kuery"]) {
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
	it.each(newFiles)("keeps %s cohesive and bounded without private imports", (path) => {
		const source = read(path);
		expect(source.split("\n").length).toBeLessThanOrEqual(400);
		expect(source).not.toMatch(/from ["'](?:kuery|@arbitre\/core)\//);
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
