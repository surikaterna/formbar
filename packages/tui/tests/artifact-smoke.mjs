import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { assertRootIsolation } from "./root-isolation.mjs";

const dist = new URL("../dist/", import.meta.url);
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const rootSource = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const expectedArtifacts = [
	"index.d.ts",
	"index.js",
	"index.js.map",
	"standalone.d.ts",
	"standalone.js",
	"standalone.js.map",
];
const expectedPackedFiles = ["README.md", ...expectedArtifacts.map((file) => `dist/${file}`), "package.json"].sort();
const expectedRootTypes = [
	"BindingResolution",
	"BoundBindingResolution",
	"ConflictedBindingResolution",
	"DEFAULT_TUI_FIELD_ADAPTER_REGISTRY",
	"DefaultBindingContribution",
	"DEFAULT_TUI_THEME",
	"FieldNavigationNode",
	"FocusNavigationGroup",
	"FormbarTui",
	"FormbarTuiProps",
	"FormNavigationSession",
	"GroupNavigationNode",
	"InteractionCleanup",
	"InteractionTarget",
	"LocalInteraction",
	"NamedActionRegistration",
	"NavigationDiagnostic",
	"NavigationDiagnosticCode",
	"NavigationMode",
	"NavigationModel",
	"NavigationNode",
	"NavigationResult",
	"NavigationSnapshot",
	"NO_COLOR_TUI_THEME",
	"ScopedInteractionCapability",
	"TargetRegistration",
	"TextInputSource",
	"TuiAdapterRegistryMode",
	"TuiCodecResult",
	"TuiDiagnostic",
	"TuiDiagnosticCode",
	"TuiEditMode",
	"TuiEditSnapshot",
	"TuiFieldAdapter",
	"TuiFieldAdapterContext",
	"TuiFieldAdapterRegistry",
	"TuiFieldAdapterResolution",
	"TuiFieldCodec",
	"TuiFieldMode",
	"TuiPrimitive",
	"TuiRendererInput",
	"TuiSubmitFailureEvent",
	"TuiSubmitSuccessEvent",
	"TuiTextStyle",
	"TuiTheme",
	"UnboundBindingResolution",
	"createFormNavigationSession",
	"createTuiFieldAdapterRegistry",
	"normalizeNavigation",
].sort();
const expectedStandaloneTypes = [
	"StandaloneDiagnostic",
	"StandaloneExitReason",
	"StandaloneExitResult",
	"StandaloneFormOwnership",
	"StandaloneInput",
	"StandaloneInputKey",
	"StandaloneInstance",
	"StandaloneOptions",
	"StandaloneSignal",
	"StandaloneSubmitEvent",
	"normalizeStandaloneInput",
	"renderStandaloneForm",
].sort();

function exportedTypes(source, path) {
	const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
	const names = [];
	for (const statement of file.statements) {
		if (ts.isExportDeclaration(statement)) {
			assert(statement.exportClause && ts.isNamedExports(statement.exportClause), `${path} has a non-named export`);
			for (const element of statement.exportClause.elements) names.push(element.name.text);
			continue;
		}
		const exported =
			ts.canHaveModifiers(statement) &&
			ts.getModifiers(statement)?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword);
		if (exported && "name" in statement && statement.name && ts.isIdentifier(statement.name))
			names.push(statement.name.text);
	}
	return names.sort();
}

function packedFiles() {
	const output = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: packageRoot, encoding: "utf8" });
	const report = JSON.parse(output);
	assert.equal(report.length, 1, "npm pack must describe exactly one package");
	return report[0].files.map(({ path }) => path).sort();
}

assert.deepEqual((await readdir(dist)).sort(), expectedArtifacts, "dist artifact allowlist changed");
assert.deepEqual(packedFiles(), expectedPackedFiles, "packed file allowlist changed");
await assertRootIsolation(rootSource, (path) => readFile(path, "utf8"));

const root = await import("@formbar/tui");
const standalone = await import("@formbar/tui/standalone");
assert.deepEqual(Object.keys(root).sort(), [
	"DEFAULT_TUI_FIELD_ADAPTER_REGISTRY",
	"DEFAULT_TUI_THEME",
	"FormbarTui",
	"NO_COLOR_TUI_THEME",
	"createFormNavigationSession",
	"createTuiFieldAdapterRegistry",
	"normalizeNavigation",
]);
assert.deepEqual(Object.keys(standalone).sort(), ["normalizeStandaloneInput", "renderStandaloneForm"]);

const rootArtifact = await readFile(new URL("index.js", dist), "utf8");
assert.doesNotMatch(rootArtifact, /from ["']node:|process\.|standalone/);

const rootTypes = await readFile(new URL("index.d.ts", dist), "utf8");
const standaloneTypes = await readFile(new URL("standalone.d.ts", dist), "utf8");
assert.deepEqual(exportedTypes(rootTypes, "index.d.ts"), expectedRootTypes);
assert.deepEqual(exportedTypes(standaloneTypes, "standalone.d.ts"), expectedStandaloneTypes);
assert.doesNotMatch(rootTypes, /node:|process[.(]|Standalone/);
assert.match(standaloneTypes, /node:tty/);

console.log("package gate: 6 artifacts and 8 packed files; exact exports; 2 ESM entrypoints");
