import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sha = "048f7b444256b609e98effc678e0f59c9a9957da";
const registryIntegrity =
	"sha512-3NeFd/gbQUbWGDG3VDK9a/btTs/6D4nZ9hYaAZkYlxrtFQE/dvuotkJqNPU67QDMDTSnpis+ozLqrMRR/1FORw==";
const root = fileURLToPath(new URL("../..", import.meta.url));
const fixtures = ["admission.mjs", "boundary.mjs", "candidate.mjs", "cjs.cjs", "types.mts", "types.cts"];
const fixtureDirectory = fileURLToPath(new URL("../../tests/consumers/kalada-preflight/", import.meta.url));
const repo = process.env.KALADA_REPO;
const published = process.env.KALADA_PUBLISHED_050_TARBALL;
assert.ok(
	repo && published,
	"Set KALADA_REPO and KALADA_PUBLISHED_050_TARBALL (npm pack @kalada/core@0.5.0 outside this script).",
);
const temp = mkdtempSync(resolve(tmpdir(), "formbar-302-kalada-"));

function run(command, args, cwd) {
	return execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

function hash(file, algorithm = "sha256", encoding = "hex") {
	return createHash(algorithm).update(readFileSync(file)).digest(encoding);
}

function manifest(file) {
	return JSON.parse(readFileSync(file, "utf8"));
}

function verifyPack(file, name, version, integrity) {
	assert.equal(`sha512-${hash(file, "sha512", "base64")}`, integrity);
	const packed = manifestFromTar(file);
	assert.equal(packed.name, name);
	assert.equal(packed.version, version);
	console.log(
		JSON.stringify({
			artifact: file,
			name,
			version,
			sha256: hash(file),
			integrity,
			dependencies: packed.dependencies ?? {},
		}),
	);
	return packed;
}

function manifestFromTar(file) {
	return JSON.parse(run("tar", ["-xOf", file, "package/package.json"], temp));
}

function pack(source, name, version) {
	const [result] = JSON.parse(
		run("npm", ["pack", "--json", "--pack-destination", temp], resolve(source, "packages", name)),
	);
	const file = resolve(temp, result.filename);
	verifyPack(file, `@kalada/${name}`, version, result.integrity);
	return file;
}

function checkNodeNext(directory) {
	return run(
		"node",
		[
			resolve(root, "node_modules", "typescript", "bin", "tsc"),
			"--noEmit",
			"--strict",
			"--module",
			"NodeNext",
			"--moduleResolution",
			"NodeNext",
			"--target",
			"ES2022",
			"--skipLibCheck",
			"types.mts",
			"types.cts",
		],
		directory,
	);
}

function installLane(lane, packs, versions) {
	const directory = resolve(temp, lane);
	mkdirSync(directory);
	writeFileSync(resolve(directory, "package.json"), JSON.stringify({ private: true, type: "module" }));
	// An empty isolated cache and --offline make any missing dependency a hard failure.
	const cache = resolve(directory, "npm-cache");
	mkdirSync(cache);
	run(
		"npm",
		[
			"install",
			"--offline",
			"--cache",
			cache,
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			"--no-save",
			"--no-package-lock",
			...packs,
		],
		directory,
	);
	for (const [name, version] of Object.entries(versions)) {
		const path = resolve(directory, "node_modules", "@kalada", name);
		assert.equal(lstatSync(path).isSymbolicLink(), false, `${lane}: ${name} workspace link`);
		const installed = manifest(resolve(path, "package.json"));
		assert.equal(installed.version, version);
		assert.deepEqual(installed.dependencies ?? {}, name === "syntax" ? { "@kalada/core": "^0.6.0" } : {});
		console.log(
			JSON.stringify({ lane, installed: installed.name, version, dependencies: installed.dependencies ?? {} }),
		);
	}
	for (const name of fixtures) copyFileSync(resolve(fixtureDirectory, name), resolve(directory, name));
	console.log(run("node", ["admission.mjs", lane], directory));
	console.log(run("node", ["cjs.cjs", lane], directory));
	console.log(checkNodeNext(directory));
}

let primaryFailure = false;
let cleanupFailure = false;
try {
	// Test-only fault injection checks cleanup before any external tools or installs run.
	if (process.env.KALADA_PREFLIGHT_FAIL_AFTER_MKDTEMP === "1") throw new Error("preflight cleanup test failure");
	assert.equal(run("git", ["rev-parse", `${sha}^{commit}`], repo), sha);
	assert.equal(run("gh", ["api", "repos/surikaterna/kalada/commits/main", "--jq", ".sha"], repo), sha);
	const publishedFile = resolve(published);
	verifyPack(publishedFile, "@kalada/core", "0.5.0", registryIntegrity);
	installLane("published", [publishedFile], { core: "0.5.0" });

	const source = resolve(temp, "candidate-source");
	mkdirSync(source);
	// Archive only committed objects at the pinned ref; never copy a mutable working tree.
	run("bash", ["-c", 'git archive "$1" | tar -x -C "$2"', "--", sha, source], repo);
	run("bun", ["install", "--frozen-lockfile"], source);
	run("bunx", ["changeset", "version"], source);
	for (const name of ["core", "syntax", "provider-routing"])
		run("bun", ["run", "--filter", `@kalada/${name}`, "build"], source);
	const candidate = [
		pack(source, "core", "0.6.0"),
		pack(source, "syntax", "0.1.0"),
		pack(source, "provider-routing", "0.1.0"),
	];
	installLane("candidate", candidate, { core: "0.6.0", syntax: "0.1.0", "provider-routing": "0.1.0" });
} catch (error) {
	primaryFailure = true;
	throw error;
} finally {
	try {
		rmSync(temp, { recursive: true, force: true });
	} catch {
		// Preserve the original failure; do not print paths from a secondary cleanup error.
		if (primaryFailure) console.error("Preflight temp cleanup also failed");
		else cleanupFailure = true;
	}
}
if (cleanupFailure) throw new Error("Preflight temp cleanup failed");
console.log(JSON.stringify({ issue: 302, source: sha, temporary: "removed", result: "passed" }));
