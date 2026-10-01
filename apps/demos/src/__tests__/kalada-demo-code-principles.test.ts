import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";
import { productionBase, productionInventory } from "./kalada-production-inventory";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const modules = import.meta.glob(["../**/*.{ts,tsx}", "../../../../packages/*/src/**/*.{ts,tsx}"], {
	query: "?raw",
	import: "default",
	eager: true,
}) as Record<string, string>;
const production = (path: string) =>
	/^(apps\/[^/]+|packages\/[^/]+)\/src\/.*\.(ts|tsx)$/.test(path) && !path.includes("/__tests__/");
function changed() {
	const git = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim().split("\n");
	return [
		...new Set(
			[
				...git(["diff", "--diff-filter=ACMR", "--name-only", productionBase, "--", "apps", "packages"]),
				...git(["ls-files", "--others", "--exclude-standard", "--", "apps", "packages"]),
			].filter(production),
		),
	].sort();
}
function budget(name: string, source: string) {
	const errors: string[] = [];
	if (source.trimEnd().split("\n").length > 400) errors.push(`${name}: file >400 lines`);
	const file = ts.createSourceFile(
		name,
		source,
		ts.ScriptTarget.Latest,
		true,
		name.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);
	const visit = (node: ts.Node) => {
		if (
			(ts.isFunctionDeclaration(node) ||
				ts.isFunctionExpression(node) ||
				ts.isArrowFunction(node) ||
				ts.isMethodDeclaration(node) ||
				ts.isConstructorDeclaration(node) ||
				ts.isGetAccessor(node) ||
				ts.isSetAccessor(node)) &&
			node.body
		) {
			const start = file.getLineAndCharacterOfPosition(node.getStart(file)).line;
			const count = file.getLineAndCharacterOfPosition(node.end).line - start + 1;
			if (count >= 50) errors.push(`${name}:${start + 1}: function ${count} lines`);
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return errors;
}

it("budgets every scoped changed production source against the explicit base/inventory without missing modules", () => {
	expect([...productionInventory].sort()).toEqual(changed());
	const sources = new Map(
		Object.entries(modules).map(([path, source]) => [
			fileURLToPath(new URL(path, import.meta.url)).slice(root.length),
			source,
		]),
	);
	const violations: string[] = [];
	for (const name of productionInventory) {
		const source = sources.get(name);
		if (source === undefined) {
			violations.push(`${name}: MISSING source`);
			continue;
		}
		violations.push(...budget(name, source));
	}
	expect(violations).toEqual([]);
});
