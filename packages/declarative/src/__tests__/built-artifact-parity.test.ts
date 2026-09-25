import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const esmPath = new URL("../../dist/index.js", import.meta.url);
const cjsPath = fileURLToPath(new URL("../../dist/index.cjs", import.meta.url));
const declarations = [
	fileURLToPath(new URL("../../dist/index.d.ts", import.meta.url)),
	fileURLToPath(new URL("../../dist/index.d.cts", import.meta.url)),
];
let esm: Record<string, unknown>;
let cjs: Record<string, unknown>;

beforeAll(async () => {
	for (const packageName of ["@formbar/expressions", "@formbar/core", "@formbar/declarative"])
		execFileSync("bun", ["run", "--filter", packageName, "build:dist"], { cwd: root, stdio: "inherit" });
	esm = await import(`${esmPath.href}?parity=${Date.now()}`);
	cjs = createRequire(import.meta.url)(cjsPath);
}, 60_000);

describe("built public export parity", () => {
	it("provides the same runtime values through ESM and CJS", () => {
		expect(runtimeExports(esm)).toEqual(["createActionExecutor", "createFormRuntime", "validateFormDefinition"]);
		expect(runtimeExports(cjs)).toEqual(runtimeExports(esm));
		expect(esm).not.toHaveProperty("sortDiagnostics");
		expect(esm).not.toHaveProperty("copyJson");
		expect(cjs).not.toHaveProperty("sortDiagnostics");
		expect(cjs).not.toHaveProperty("copyJson");
	});

	it.each(declarations)("matches declared runtime values in %s", (declaration) => {
		const exports = declarationExports(declaration);
		expect(exports.runtime).toEqual(runtimeExports(esm));
		expect(exports.all).toEqual(expect.arrayContaining(["Expression", "PropDefinitions", "Segment", "StateRef"]));
		expect(exports.all).not.toContain("copyJson");
		expect(exports.all).not.toContain("sortDiagnostics");
	});
});

function runtimeExports(module: Record<string, unknown>): readonly string[] {
	return Object.keys(module).sort();
}

function declarationExports(declaration: string): {
	readonly all: readonly string[];
	readonly runtime: readonly string[];
} {
	const program = ts.createProgram([declaration], {
		module: ts.ModuleKind.NodeNext,
		moduleResolution: ts.ModuleResolutionKind.NodeNext,
		skipLibCheck: true,
	});
	const source = program.getSourceFile(declaration);
	if (!source) throw new Error(`Missing declaration output: ${declaration}`);
	const module = program.getTypeChecker().getSymbolAtLocation(source);
	if (!module) throw new Error(`Missing declaration module: ${declaration}`);
	const checker = program.getTypeChecker();
	const exports = checker.getExportsOfModule(module);
	return {
		all: exports.map(({ name }) => name).sort(),
		runtime: exports
			.filter((symbol) => isRuntimeSymbol(symbol, checker))
			.map(({ name }) => name)
			.sort(),
	};
}

function isRuntimeSymbol(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
	const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
	return Boolean(target.flags & ts.SymbolFlags.Value);
}
