import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { consumed, initialVersions, rcVersion } from "../../release/rc-reviewed-plan";
import { kaladaProductionDependencies, rcEdges, rcPackages } from "../../release/rc-workspace-plan.mjs";
import { npmPackDryRun } from "../npm-pack";
import { type PackageManifest, packagePolicies } from "../policy";
import {
	validateAllowedFiles,
	validateExportTargets,
	validateLicense,
	validateRcDependencies,
	validateRcPlan,
	validateSourceMaps,
	validateVersion,
} from "../validate";

const temporaryDirectories: string[] = [];
const policy = packagePolicies.find(({ directory }) => directory === "core");
if (!policy) throw new Error("core package policy is required");
const standardFiles = ["LICENSE", "README.md", "package.json"];
const activePreFixture = {
	mode: "pre",
	tag: "rc",
	initialVersions: { ...initialVersions, "@formbar/fsx-authoring": "0.0.0", "@formbar/fsx-editor": "0.0.0" },
	changesets: consumed,
};

function temporaryDirectory(name: string): string {
	const directory = mkdtempSync(resolve(tmpdir(), `formbar-${name}-`));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function exportFixture(): PackageManifest {
	return {
		main: "./dist/index.cjs",
		module: "./dist/index.js",
		types: "./dist/index.d.ts",
		exports: Object.fromEntries(
			[".", "./path", "./transforms", "./validation", "./internal/submit-proof", "./internal/scoped-sync"].map(
				(subpath) => {
					const stem =
						subpath === "."
							? "index"
							: subpath.startsWith("./internal/")
								? subpath.slice(2)
								: `${subpath.slice(2)}.entry`;
					return [
						subpath,
						{
							import: { types: `./dist/${stem}.d.ts`, default: `./dist/${stem}.js` },
							require: { types: `./dist/${stem}.d.cts`, default: `./dist/${stem}.cjs` },
						},
					];
				},
			),
		),
	} as PackageManifest;
}

describe("package artifact policy", () => {
	it("requires reviewed RC pre mode and strictly formed versions", () => {
		const root = temporaryDirectory("rc-version");
		const pre = resolve(root, ".changeset/pre.json");
		mkdirSync(resolve(root, ".changeset"));
		expect(() => validateVersion(policy, "0.23.0", root)).not.toThrow();
		expect(() => validateVersion(policy, "0.23.0-rc.0", root)).toThrow(/requires pre.json/);
		for (const value of [
			{ mode: "exit", tag: "rc" },
			{ mode: "pre", tag: "beta" },
		]) {
			writeFileSync(pre, JSON.stringify(value));
			expect(() => validateVersion(policy, "0.23.0-rc.0", root)).toThrow(/pre mode rc/);
		}
		writeFileSync(pre, JSON.stringify({ mode: "pre", tag: "rc" }));
		for (const version of ["0.23.0-rc.0", "0.23.0-rc.12"]) {
			expect(() => validateVersion(policy, version, root)).not.toThrow();
		}
		for (const version of [
			"",
			"0.23",
			"01.23.0",
			"0.23.0-rc.01",
			"0.23.0-beta.0",
			"0.23.0-rc.0+build",
			"0.23.0-rc.0extra",
		]) {
			expect(() => validateVersion(policy, version, root)).toThrow(/invalid version/);
		}
	});

	it("does not allow a prerelease internal dependency floor above the target", () => {
		const versions = { "@formbar/core": "0.23.0-rc.0" };
		expect(() =>
			validateRcDependencies(
				policy,
				{ version: "0.23.0-rc.0", dependencies: { "@formbar/core": "^0.23.0-rc.0" } } as PackageManifest,
				versions,
			),
		).not.toThrow();
		for (const range of ["^0.23.0-rc.00", "^0.23.0-rc.1", "^0.23.0", "^0.22.0-rc.0", "0.23.0-rc.0", "^0.23.0-beta.0"]) {
			expect(() =>
				validateRcDependencies(
					policy,
					{ version: "0.23.0-rc.0", dependencies: { "@formbar/core": range } } as PackageManifest,
					versions,
				),
			).toThrow(/invalid prerelease dependency/);
		}
	});
	it("rejects mixed stable and RC internal dependencies in an RC manifest", () => {
		const manifest = (version: string, range: string) =>
			({ version, dependencies: { "@formbar/core": range } }) as PackageManifest;
		const versions = { "@formbar/core": "0.22.2" };
		expect(() => validateRcDependencies(policy, manifest("0.23.0-rc.0", "^0.23.0-rc.0"), versions)).toThrow(
			/invalid prerelease dependency/,
		);
		expect(() => validateRcDependencies(policy, manifest("0.23.0-rc.0", "^0.22.2"), versions)).toThrow(
			/invalid prerelease dependency/,
		);
		expect(() =>
			validateRcDependencies(policy, manifest("0.23.0-rc.0", "^0.14.3"), { "@formbar/core": "0.14.3" }),
		).toThrow(/invalid prerelease dependency/);
		const expressions = { "@formbar/expressions": "0.14.3" };
		const withExpressions = (range: string) =>
			({ version: "0.23.0-rc.0", dependencies: { "@formbar/expressions": range } }) as PackageManifest;
		expect(() => validateRcDependencies(policy, withExpressions("^0.14.3"), expressions)).not.toThrow();
		expect(() =>
			validateRcDependencies(
				policy,
				{
					version: "0.23.0-rc.0",
					dependencies: { "@formbar/expressions": "^0.14.3", "@formbar/core": "^0.23.0-rc.0" },
				} as PackageManifest,
				{ ...expressions, ...versions },
			),
		).toThrow(/invalid prerelease dependency @formbar\/core/);
		for (const range of ["^0.14.4", "^0.15.0", "^0.14.3-rc.0"]) {
			expect(() => validateRcDependencies(policy, withExpressions(range), expressions)).toThrow(
				/invalid prerelease dependency/,
			);
		}
		const rcExpressions = { "@formbar/expressions": "0.23.0-rc.0" };
		expect(() => validateRcDependencies(policy, withExpressions("^0.23.0-rc.0"), rcExpressions)).not.toThrow();
		for (const range of ["^0.14.3", "^0.23.0-rc.1", "^0.23.0", "^0.23.0-rc.00"]) {
			expect(() => validateRcDependencies(policy, withExpressions(range), rcExpressions)).toThrow(
				/invalid prerelease dependency/,
			);
		}
		expect(() => validateRcDependencies(policy, withExpressions("^0.23.0-rc.0"), expressions)).toThrow(
			/invalid prerelease dependency/,
		);
		expect(() => validateRcDependencies(policy, manifest("0.14.3", "^0.22.2"), versions)).not.toThrow();
	});
	it("binds the nine RC manifest graph to the active workspace plan", () => {
		const root = temporaryDirectory("nine-rc-plan");
		mkdirSync(resolve(root, ".changeset"));
		const pre = activePreFixture;
		const prePath = resolve(root, ".changeset/pre.json");
		const manifests = rcPackages.map((name) => ({
			name: `@formbar/${name}`,
			version: rcVersion,
			dependencies: {
				...Object.fromEntries(rcEdges[name].map((edge) => [`@formbar/${edge}`, `^${rcVersion}`])),
				...kaladaProductionDependencies[`@formbar/${name}`],
			},
		})) as PackageManifest[];
		writeFileSync(prePath, JSON.stringify(pre));
		for (const manifest of manifests) {
			mkdirSync(resolve(root, `packages/${manifest.name.slice(9)}`), { recursive: true });
			writeFileSync(resolve(root, `packages/${manifest.name.slice(9)}/package.json`), JSON.stringify(manifest));
		}
		expect(() => validateRcPlan(root, manifests)).not.toThrow();
		expect(() => validateRcPlan(root, manifests.slice(1))).toThrow(/incomplete nine-package/);
		expect(() =>
			validateRcPlan(root, [...manifests, { name: "@formbar/extra", version: rcVersion } as PackageManifest]),
		).toThrow(/incomplete nine-package/);
		for (const changed of [
			{ ...manifests[0], version: "0.14.3" },
			{ ...manifests[1], dependencies: { "@formbar/expressions": "^0.14.3" } },
			{ ...manifests[1], dependencies: { ...manifests[1].dependencies, "@formbar/react": `^${rcVersion}` } },
		]) {
			expect(() =>
				validateRcPlan(
					root,
					manifests.map((item) => (item.name === changed.name ? changed : item)),
				),
			).toThrow();
		}
		for (const forged of [
			{ ...pre, mode: "exit" },
			{ ...pre, changesets: [...consumed, consumed[0]] },
			{ ...pre, initialVersions: { ...pre.initialVersions, "@formbar/expressions": undefined } },
			{ ...pre, injected: true },
		]) {
			writeFileSync(prePath, JSON.stringify(forged));
			expect(() => validateRcPlan(root, manifests)).toThrow();
		}
	});
	it("rejects a test file selected by native npm pack", () => {
		const directory = temporaryDirectory("pack-leak");
		mkdirSync(resolve(directory, "src/__tests__"), { recursive: true });
		writeFileSync(
			resolve(directory, "package.json"),
			JSON.stringify({ name: policy.name, version: "1.0.0", files: ["src"] }),
		);
		writeFileSync(resolve(directory, "README.md"), "fixture\n");
		writeFileSync(resolve(directory, "LICENSE"), "fixture\n");
		writeFileSync(resolve(directory, "src/__tests__/leak.test.ts"), "export {};\n");
		const files = npmPackDryRun(directory).files.map(({ path }) => path);
		expect(files).toContain("src/__tests__/leak.test.ts");
		expect(() => validateAllowedFiles(policy, files)).toThrow(/prohibited packed file/);
		expect(() => validateAllowedFiles(policy, [...standardFiles, "dist/leak.test.js"])).toThrow(
			/prohibited packed file/,
		);
	}, 25_000); // Native npm pack is a subprocess; hosted CI exceeded Vitest's 5s default under concurrent load (#422).

	it("requires every runtime, declaration, and subpath target to be packed", () => {
		const manifest = exportFixture();
		const files = [
			...standardFiles,
			...Object.values(manifest.exports).flatMap((entry) =>
				[...Object.values(entry.import), ...Object.values(entry.require)].map((target) => target.slice(2)),
			),
		];
		expect(() => validateExportTargets(policy, manifest, files)).not.toThrow();
		for (const target of files.filter((file) => file.startsWith("dist/"))) {
			expect(() =>
				validateExportTargets(
					policy,
					manifest,
					files.filter((file) => file !== target),
				),
			).toThrow(/not packed/);
		}
		const mutated = (exports: unknown, overrides = {}) => ({ ...manifest, ...overrides, exports }) as PackageManifest;
		const root = manifest.exports["."];
		const invalid = [
			mutated({ ...manifest.exports, ".": { types: manifest.types, ...root } }),
			mutated({ ...manifest.exports, ".": { ...root, default: manifest.module } }),
			mutated({ ...manifest.exports, ".": { import: root.import } }),
			mutated({ ...manifest.exports, ".": { require: root.require, import: root.import } }),
			mutated({
				...manifest.exports,
				".": { ...root, require: { default: root.require.default, types: root.require.types } },
			}),
			mutated({ ...manifest.exports, ".": { ...root, require: { ...root.require, types: root.import.types } } }),
			mutated({ ...manifest.exports, ".": { ...root, require: { ...root.require, default: root.import.default } } }),
			mutated({ ...manifest.exports, "./path": { ...manifest.exports["./path"], import: root.import } }),
			mutated(manifest.exports, { main: manifest.module }),
			mutated(manifest.exports, { types: root.require.types }),
			mutated(manifest.exports, { module: manifest.main }),
			mutated({ ...manifest.exports, "./extra": root }),
		];
		for (const entry of invalid) expect(() => validateExportTargets(policy, entry, files)).toThrow();
	});

	it("accepts complete relative production maps and rejects local or test sources", () => {
		const directory = temporaryDirectory("maps");
		mkdirSync(resolve(directory, "dist"));
		mkdirSync(resolve(directory, "src"));
		writeFileSync(resolve(directory, "src/index.ts"), "export const value = 1;\n");
		writeFileSync(resolve(directory, "dist/index.js"), "export const value = 1;\n//# sourceMappingURL=index.js.map\n");
		const map = {
			version: 3,
			sources: ["../src/index.ts"],
			sourcesContent: [readFileSync(resolve(directory, "src/index.ts"), "utf8")],
		};
		writeFileSync(resolve(directory, "dist/index.js.map"), JSON.stringify(map));
		const files = [...standardFiles, "dist/index.js", "dist/index.js.map"];
		expect(validateSourceMaps(policy, directory, files)).toEqual({ maps: 1, sources: 1 });
		writeFileSync(resolve(directory, "dist/index.js.map"), JSON.stringify({ ...map, sources: ["/tmp/index.ts"] }));
		expect(() => validateSourceMaps(policy, directory, files)).toThrow(/relative path/);
		writeFileSync(
			resolve(directory, "dist/index.js.map"),
			JSON.stringify({ ...map, sources: ["../src/__tests__/x.ts"] }),
		);
		expect(() => validateSourceMaps(policy, directory, files)).toThrow(/unsafe source/);
	});

	it("detects package license drift from the repository root", () => {
		const root = temporaryDirectory("license");
		const packageDirectory = resolve(root, "packages/core");
		mkdirSync(packageDirectory, { recursive: true });
		writeFileSync(resolve(root, "LICENSE"), "canonical\n");
		writeFileSync(resolve(packageDirectory, "LICENSE"), "changed\n");
		expect(() => validateLicense(root, packageDirectory)).toThrow(/differs from repository root/);
	});
});
