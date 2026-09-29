import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, test } from "vitest";

test("only the 600 independent-completion case has an extended timeout", () => {
	const source = ts.createSourceFile(
		"scoped-capture-receipt.test.ts",
		readFileSync(new URL("./scoped-capture-receipt.test.ts", import.meta.url), "utf8"),
		ts.ScriptTarget.Latest,
		true,
	);
	const cases: Array<{ name: string; timeout: string }> = [];
	function visit(node: ts.Node): void {
		if (ts.isCallExpression(node) && node.expression.getText(source).startsWith("test")) {
			const name = node.arguments[0]?.getText(source) ?? "";
			if (name.includes("independent completions across one detachment")) {
				cases.push({ name, timeout: node.arguments.at(-1)?.getText(source) ?? "" });
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
	expect(cases).toEqual([
		{ name: '"accepts %i independent completions across one detachment"', timeout: "30_000" },
		{ name: '"accepts 600 independent completions across one detachment"', timeout: "90_000" },
	]);
	expect(source.text).toContain("test.each([100, 300])");
	expect(source.text).toContain("() => settle(600), 90_000");
});
