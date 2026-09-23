import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { npmPackDryRun } from "../npm-pack";
import { type PackageManifest, packagePolicies } from "../policy";
import { validateAllowedFiles, validateExportTargets, validateLicense, validateSourceMaps } from "../validate";

const temporaryDirectories: string[] = [];
const policy = packagePolicies.find(({ directory }) => directory === "core");
if (!policy) throw new Error("core package policy is required");
const standardFiles = ["LICENSE", "README.md", "package.json"];

function temporaryDirectory(name: string): string {
	const directory = mkdtempSync(resolve(tmpdir(), `formbar-${name}-`));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("package artifact policy", () => {
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
	});

	it("requires every runtime, declaration, and subpath target to be packed", () => {
		const manifest = {
			main: "./dist/index.cjs",
			module: "./dist/index.js",
			types: "./dist/index.d.ts",
			exports: {
				".": { types: "./dist/index.d.ts", import: "./dist/index.js", require: "./dist/index.cjs" },
				"./path": { types: "./dist/path.d.ts", import: "./dist/path.js", require: "./dist/path.cjs" },
			},
		} as PackageManifest;
		const files = [...standardFiles, "dist/index.cjs", "dist/index.js", "dist/index.d.ts"];
		expect(() => validateExportTargets(policy, manifest, files)).toThrow(/path.*target is not packed/);
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
