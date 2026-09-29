import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

describe("artifact policy timeout scope", () => {
	it("keeps the native npm pack case as the only explicit test timeout", () => {
		const source = ts.createSourceFile(
			"artifact-policy.test.ts",
			readFileSync(new URL("./artifact-policy.test.ts", import.meta.url), "utf8"),
			ts.ScriptTarget.Latest,
			true,
		);
		const overrides: string[] = [];
		let testCount = 0;
		function visit(node: ts.Node): void {
			if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "it") {
				testCount++;
				if (node.arguments.length > 2) {
					overrides.push(`${node.arguments[0].getText(source)}: ${node.arguments[2].getText(source)}`);
				}
			}
			ts.forEachChild(node, visit);
		}
		visit(source);
		expect(testCount).toBe(8);
		expect(overrides).toEqual(['"rejects a test file selected by native npm pack": 25_000']);
	});
});
