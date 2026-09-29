import { deepStrictEqual } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { extractTarball, npmPack, npmPackDryRun } from "./npm-pack";
import { type PackageManifest, packagePolicies } from "./policy";
import {
	validateAllowedFiles,
	validateLicense,
	validateManifest,
	validateRcDependencies,
	validateRcPlan,
	validateSourceMaps,
} from "./validate";

export interface PackageAudit {
	readonly bytes: Buffer;
	readonly files: readonly string[];
	readonly maps: number;
	readonly name: string;
	readonly sha256: string;
	readonly sources: number;
}

const paths = (files: readonly { readonly path: string }[]): string[] => files.map(({ path }) => path).sort();

function readManifest(directory: string): PackageManifest {
	return JSON.parse(readFileSync(resolve(directory, "package.json"), "utf8")) as PackageManifest;
}

function validateWorkspaceSet(root: string): void {
	const discovered = readdirSync(resolve(root, "packages"), { withFileTypes: true })
		.filter(
			(entry) => entry.isDirectory() && readdirSync(resolve(root, "packages", entry.name)).includes("package.json"),
		)
		.map(({ name }) => name)
		.sort();
	deepStrictEqual(
		discovered,
		packagePolicies.map(({ directory }) => directory).sort(),
		"unrecognized workspace package",
	);
}

function validatePackedManifest(source: PackageManifest, packedDirectory: string): void {
	const packed = readManifest(packedDirectory);
	deepStrictEqual(packed, source, `${source.name}: packed package.json differs from source`);
}

function auditPackage(
	root: string,
	packRoot: string,
	index: number,
	versions: Readonly<Record<string, string>>,
): PackageAudit {
	const policy = packagePolicies[index];
	const packageDirectory = resolve(root, "packages", policy.directory);
	const dryRun = npmPackDryRun(packageDirectory);
	const packed = npmPack(packageDirectory, packRoot);
	const files = paths(packed.files);
	deepStrictEqual(files, paths(dryRun.files), `${policy.name}: dry-run and packed file lists differ`);
	validateAllowedFiles(policy, files);
	const manifest = readManifest(packageDirectory);
	validateManifest(policy, manifest, files, root);
	validateRcDependencies(policy, manifest, versions);
	if (
		packed.name !== manifest.name ||
		packed.version !== manifest.version ||
		dryRun.version !== manifest.version ||
		packed.filename !== `${manifest.name.slice(1).replace("/", "-")}-${manifest.version}.tgz`
	)
		throw new Error(`${policy.name}: npm pack metadata differs from manifest`);
	if (/^.+-rc\.(?:0|[1-9]\d*)$/.test(manifest.version)) {
		const changelog = readFileSync(resolve(packageDirectory, "CHANGELOG.md"), "utf8");
		if (!changelog.split("\n").includes(`## ${manifest.version}`))
			throw new Error(`${policy.name}: missing RC changelog entry`);
	}
	const mapAudit = validateSourceMaps(policy, packageDirectory, files);
	const tarball = resolve(packRoot, basename(packed.filename));
	const extracted = resolve(packRoot, `extracted-${policy.directory}`);
	extractTarball(tarball, extracted);
	const packedDirectory = resolve(extracted, "package");
	validatePackedManifest(manifest, packedDirectory);
	validateLicense(root, packageDirectory, packedDirectory);
	const bytes = readFileSync(tarball);
	return {
		bytes,
		files,
		maps: mapAudit.maps,
		name: policy.name,
		sha256: createHash("sha256").update(bytes).digest("hex"),
		sources: mapAudit.sources,
	};
}

export function auditPackages(root: string): PackageAudit[] {
	validateWorkspaceSet(root);
	const manifests = packagePolicies.map((policy) => readManifest(resolve(root, "packages", policy.directory)));
	validateRcPlan(root, manifests);
	const versions = Object.fromEntries(manifests.map(({ name, version }) => [name, version]));
	const packRoot = mkdtempSync(join(tmpdir(), "formbar-native-packs-"));
	try {
		return packagePolicies.map((_, index) => auditPackage(root, packRoot, index, versions));
	} finally {
		rmSync(packRoot, { recursive: true, force: true });
	}
}
