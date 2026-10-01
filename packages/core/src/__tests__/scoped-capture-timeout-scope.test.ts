import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, test } from "vitest";

type Case = { name: string; counts: number[] | null; timeout: number | null };

function numericValue(node: ts.Node | undefined): number | null {
	return node && ts.isNumericLiteral(node) ? Number(node.text) : null;
}

function testCase(node: ts.Node): Case | null {
	if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)) return null;
	const call = node.expression;
	const callee = call.expression;
	const each =
		ts.isCallExpression(callee) &&
		ts.isPropertyAccessExpression(callee.expression) &&
		callee.expression.name.text === "each";
	const runner = each ? callee.expression.expression : callee;
	if (!ts.isIdentifier(runner) || (runner.text !== "test" && runner.text !== "it")) return null;
	const title = call.arguments[0];
	if (!title || !ts.isStringLiteral(title)) return null;
	const values = each ? callee.arguments[0] : undefined;
	const counts = values && ts.isArrayLiteralExpression(values) ? values.elements.map(numericValue) : null;
	const timeout = call.arguments[2];
	return {
		name: title.text,
		counts: counts?.every((value): value is number => value !== null) ? counts : null,
		timeout: timeout === undefined ? null : (numericValue(timeout) ?? Number.NaN),
	};
}

function suiteCases(text: string): Case[][] {
	const source = ts.createSourceFile("receipt.test.ts", text, ts.ScriptTarget.Latest, true);
	const suites: Case[][] = [];
	function visit(node: ts.Node): void {
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "describe") {
			const [title, callback] = node.arguments;
			if (
				title &&
				ts.isStringLiteral(title) &&
				title.text === "private scoped capture ownership receipt" &&
				callback &&
				(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
				ts.isBlock(callback.body)
			) {
				suites.push(
					callback.body.statements.flatMap((statement) => {
						const result = testCase(statement);
						return result ? [result] : [];
					}),
				);
			}
		}
		ts.forEachChild(node, visit);
	}
	visit(source);
	return suites;
}

test("only the 600 independent-completion case has an extended timeout", () => {
	const text = readFileSync(new URL("./scoped-capture-receipt.test.ts", import.meta.url), "utf8");
	const suites = suiteCases(text);
	expect(suites).toHaveLength(1);
	const cases = suites[0] ?? [];
	expect(cases.filter(({ timeout }) => timeout === 90_000)).toHaveLength(1);
	expect(cases.filter(({ name }) => name.includes("independent completions across one detachment"))).toEqual([
		{ name: "accepts %i independent completions across one detachment", counts: [100, 300], timeout: 30_000 },
		{ name: "accepts 600 independent completions across one detachment", counts: null, timeout: 90_000 },
	]);
	expect(cases.filter(({ name }) => name.includes("metadata settlements"))).toEqual([
		{
			name: "owned %i metadata settlements avoid data scans and preserve notification count",
			counts: [100, 300, 600],
			timeout: 30_000,
		},
	]);
	expect(
		cases
			.filter(({ name }) => !name.includes("independent completions") && !name.includes("metadata settlements"))
			.every(({ timeout }) => timeout === null || timeout === 30_000),
	).toBe(true);
});

test("timeout inspection ignores quote style, spacing, callback form and numeric separators", () => {
	const suites = suiteCases(`describe('private scoped capture ownership receipt', function () {
		it.each( [ 100 , 300 ] )( 'accepts %i independent completions across one detachment', settle, 30000 );
		test( 'accepts 600 independent completions across one detachment', settle, 90000 );
	});`);
	expect(suites).toEqual([
		[
			{ name: "accepts %i independent completions across one detachment", counts: [100, 300], timeout: 30_000 },
			{ name: "accepts 600 independent completions across one detachment", counts: null, timeout: 90_000 },
		],
	]);
});
