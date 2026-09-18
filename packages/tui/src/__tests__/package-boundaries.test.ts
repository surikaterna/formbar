import { readFile } from "node:fs/promises";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const packageRoot = new URL("../../", import.meta.url);
const rootTypes = [
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
const standaloneTypes = [
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

async function text(path: string): Promise<string> {
	return readFile(new URL(path, packageRoot), "utf8");
}

function typeExports(source: string, path: string): string[] {
	const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
	const names: string[] = [];

	for (const statement of file.statements) {
		if (ts.isExportDeclaration(statement)) {
			if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) return ["<non-named-export>"];
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

describe("@formbar/tui package contract", () => {
	it("has exact process-free runtime exports", async () => {
		const root = await import("../index.js");
		const standalone = await import("../standalone.js");

		expect(Object.keys(root).sort()).toEqual([
			"DEFAULT_TUI_FIELD_ADAPTER_REGISTRY",
			"DEFAULT_TUI_THEME",
			"FormbarTui",
			"NO_COLOR_TUI_THEME",
			"createFormNavigationSession",
			"createTuiFieldAdapterRegistry",
			"normalizeNavigation",
		]);
		expect(Object.keys(standalone).sort()).toEqual(["normalizeStandaloneInput", "renderStandaloneForm"]);
	}, 15_000);

	it("has exact root and standalone public type allowlists", async () => {
		expect(typeExports(await text("src/index.ts"), "index.ts")).toEqual(rootTypes);
		expect(typeExports(await text("src/standalone.ts"), "standalone.ts")).toEqual(standaloneTypes);
		expect(rootTypes).not.toEqual(expect.arrayContaining(standaloneTypes));
	});

	it("publishes only ESM root and standalone entry claims", async () => {
		const manifest = JSON.parse(await text("package.json"));

		expect(manifest).toMatchObject({
			name: "@formbar/tui",
			version: "0.0.0",
			private: true,
			type: "module",
			files: ["dist", "README.md"],
			engines: { node: ">=20" },
			peerDependencies: { ink: "^6.5.0", react: ">=19.0.0" },
		});
		expect(Object.keys(manifest.exports)).toEqual([".", "./standalone", "./package.json"]);
		expect(JSON.stringify(manifest.exports)).not.toContain("require");
		expect(manifest.main).toBeUndefined();
	});

	it("keeps Node ownership in standalone", async () => {
		expect(await text("src/standalone-types.ts")).toContain('from "node:tty"');
		expect(await text("src/standalone-runtime.tsx")).toContain("process.stdin");
	});
});
