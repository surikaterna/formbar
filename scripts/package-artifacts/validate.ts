import { deepStrictEqual, strictEqual } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, posix, relative, resolve } from "node:path";
import type { ExportConditions, PackageManifest, PackagePolicy } from "./policy";
import { exportEntries, expressionAdr, standardPackageFiles } from "./policy";

const distributionFile = /^dist\/.+\.(?:js|cjs|d\.ts|d\.cts|js\.map|cjs\.map)$/;
const prohibitedArtifact =
	/(^|\/)(?:(?:__)?tests?|specs?|__fixtures__|fixtures?|__snapshots__|src|scripts?|node_modules|\.changeset)(?:\/|\.|$)|(^|\/)[^/]+\.(?:test|spec|snap)(?:\.|$)|(^|\/)(?:tsconfig|tsup\.config|vitest\.config|vite\.config|package-lock|pnpm-lock|yarn\.lock|bun\.lock|pnpm-workspace|\.env)(?:\.|$)/i;
const unsafeMapSource =
	/(^|\/)(?:__tests__|tests?|__fixtures__|fixtures?|node_modules|config|scripts?|secrets?)(?:\/|\.|$)/i;
const semver = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

export interface MapAudit {
	readonly maps: number;
	readonly sources: number;
}

function fail(policy: PackagePolicy, message: string): never {
	throw new Error(`${policy.name}: ${message}`);
}

export function validateAllowedFiles(policy: PackagePolicy, files: readonly string[]): void {
	const allowed = (path: string): boolean =>
		standardPackageFiles.includes(path as (typeof standardPackageFiles)[number]) ||
		distributionFile.test(path) ||
		(policy.directory === "expressions" && path === expressionAdr);
	for (const path of files) {
		if (prohibitedArtifact.test(path)) fail(policy, `prohibited packed file ${path}`);
		if (!allowed(path)) fail(policy, `unapproved packed file ${path}`);
	}
	for (const required of standardPackageFiles) {
		if (!files.includes(required)) fail(policy, `missing required packed file ${required}`);
	}
}

function packageTarget(target: string, policy: PackagePolicy): string {
	if (!target.startsWith("./")) fail(policy, `package target must be relative: ${target}`);
	const normalized = posix.normalize(target.slice(2));
	if (normalized.startsWith("../") || normalized === "..") fail(policy, `package target escapes package: ${target}`);
	return normalized;
}

export function validateManifest(policy: PackagePolicy, manifest: PackageManifest, files: readonly string[]): void {
	strictEqual(manifest.name, policy.name, `${policy.name}: package name`);
	strictEqual(manifest.type, "module", `${policy.name}: package type`);
	strictEqual(manifest.license, "MIT", `${policy.name}: license metadata`);
	strictEqual(manifest.sideEffects, false, `${policy.name}: sideEffects metadata`);
	if (!semver.test(manifest.version)) fail(policy, `invalid version ${manifest.version}`);
	deepStrictEqual(manifest.files, [...policy.manifestFiles], `${policy.name}: manifest files allowlist`);
	validateRepository(policy, manifest);
	validateExportTargets(policy, manifest, files);
}

function validateRepository(policy: PackagePolicy, manifest: PackageManifest): void {
	deepStrictEqual(
		manifest.repository,
		{
			type: "git",
			url: "git+https://github.com/surikaterna/formbar.git",
			directory: `packages/${policy.directory}`,
		},
		`${policy.name}: repository metadata`,
	);
}

function validateExportBranch(
	policy: PackagePolicy,
	subpath: string,
	condition: "import" | "require",
	branch: ExportConditions["import"],
	stem: string,
	files: readonly string[],
): void {
	deepStrictEqual(
		Object.keys(branch ?? {}),
		["types", "default"],
		`${policy.name}: ${subpath} ${condition} condition order`,
	);
	const extension = condition === "import" ? { types: "d.ts", default: "js" } : { types: "d.cts", default: "cjs" };
	for (const key of ["types", "default"] as const) {
		const target = branch[key];
		if (target !== `./dist/${stem}.${extension[key]}`)
			fail(policy, `${subpath} ${condition} ${key} target mismatch: ${target}`);
		const path = packageTarget(target, policy);
		if (!files.includes(path)) fail(policy, `${subpath} ${condition} ${key} target is not packed: ${path}`);
	}
}

export function validateExportTargets(
	policy: PackagePolicy,
	manifest: PackageManifest,
	files: readonly string[],
): void {
	const expected = policy.directory === "core" ? exportEntries : exportEntries.slice(0, 1);
	const subpaths = [
		...expected,
		...(["core", "declarative"].includes(policy.directory) ? ["./internal/scoped-sync"] : []),
	];
	deepStrictEqual(Object.keys(manifest.exports ?? {}), subpaths, `${policy.name}: export subpaths`);
	deepStrictEqual(
		{ types: manifest.types, module: manifest.module, main: manifest.main },
		{ types: "./dist/index.d.ts", module: "./dist/index.js", main: "./dist/index.cjs" },
		`${policy.name}: root entry metadata`,
	);
	for (const [subpath, conditions] of Object.entries(manifest.exports)) {
		const stem =
			subpath === "."
				? "index"
				: subpath === "./internal/scoped-sync"
					? "internal/scoped-sync"
					: `${subpath.slice(2)}.entry`;
		deepStrictEqual(Object.keys(conditions), ["import", "require"], `${policy.name}: ${subpath} condition order`);
		for (const condition of ["import", "require"] as const)
			validateExportBranch(policy, subpath, condition, conditions[condition], stem, files);
	}
}

export function validateLicense(root: string, packageDirectory: string, packedDirectory?: string): void {
	const expected = readFileSync(resolve(root, "LICENSE"));
	const packageLicense = readFileSync(resolve(packageDirectory, "LICENSE"));
	if (!expected.equals(packageLicense)) throw new Error(`${packageDirectory}: LICENSE differs from repository root`);
	if (!packedDirectory) return;
	const packedLicense = readFileSync(resolve(packedDirectory, "LICENSE"));
	if (!expected.equals(packedLicense))
		throw new Error(`${packageDirectory}: packed LICENSE differs from repository root`);
}

function sourceMapReferences(runtime: string, policy: PackagePolicy): readonly string[] {
	const contents = readFileSync(runtime, "utf8");
	const matches = [...contents.matchAll(/\/\/[#@] sourceMappingURL=([^\s]+)\s*$/gm)];
	if (matches.length === 0) fail(policy, `${runtime}: expected a source-map reference`);
	return matches.map((match) => match[1]);
}

function validateMapSource(packageDirectory: string, mapPath: string, source: string, content: unknown): void {
	if (!source || isAbsolute(source) || source.includes("\\") || /^[a-z][a-z+.-]*:/i.test(source)) {
		throw new Error(`${mapPath}: source must be a relative path: ${source}`);
	}
	if (unsafeMapSource.test(source)) throw new Error(`${mapPath}: unsafe source ${source}`);
	const sourcePath = resolve(dirname(resolve(packageDirectory, mapPath)), source);
	const sourceRoot = resolve(packageDirectory, "src");
	if (relative(sourceRoot, sourcePath).startsWith("..") || !existsSync(sourcePath)) {
		throw new Error(`${mapPath}: source is not present production source: ${source}`);
	}
	if (typeof content !== "string" || readFileSync(sourcePath, "utf8") !== content) {
		throw new Error(`${mapPath}: sourcesContent does not match ${source}`);
	}
}

function validateMap(packageDirectory: string, mapPath: string): number {
	const map = JSON.parse(readFileSync(resolve(packageDirectory, mapPath), "utf8")) as {
		sourceRoot?: unknown;
		sources?: unknown;
		sourcesContent?: unknown;
		version?: unknown;
	};
	if (map.version !== 3 || (map.sourceRoot !== undefined && map.sourceRoot !== "")) {
		throw new Error(`${mapPath}: unsupported map metadata`);
	}
	if (!Array.isArray(map.sources)) throw new Error(`${mapPath}: sources are required`);
	const sourcesContent = map.sourcesContent ?? (map.sources.length === 0 ? [] : undefined);
	if (!Array.isArray(sourcesContent)) throw new Error(`${mapPath}: sourcesContent is required for listed sources`);
	strictEqual(map.sources.length, sourcesContent.length, `${mapPath}: incomplete sourcesContent`);
	for (const [index, source] of map.sources.entries()) {
		if (typeof source !== "string") throw new Error(`${mapPath}: source ${index} is not a string`);
		validateMapSource(packageDirectory, mapPath, source, sourcesContent[index]);
	}
	return map.sources.length;
}

export function validateSourceMaps(
	policy: PackagePolicy,
	packageDirectory: string,
	files: readonly string[],
): MapAudit {
	const runtimes = files.filter((path) => /^dist\/.+\.(?:js|cjs)$/.test(path));
	const maps = files.filter((path) => /^dist\/.+\.(?:js|cjs)\.map$/.test(path));
	for (const runtime of runtimes) {
		for (const reference of sourceMapReferences(resolve(packageDirectory, runtime), policy)) {
			const mapPath = posix.normalize(posix.join(posix.dirname(runtime), reference));
			if (!files.includes(mapPath)) fail(policy, `${runtime}: referenced map is not packed: ${mapPath}`);
		}
	}
	for (const map of maps) if (!files.includes(map.slice(0, -4))) fail(policy, `${map}: runtime is not packed`);
	return { maps: maps.length, sources: maps.reduce((count, map) => count + validateMap(packageDirectory, map), 0) };
}
