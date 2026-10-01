// Read-only with respect to both repositories; all outputs live in a unique ignored run directory.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const commit = "048f7b444256b609e98effc678e0f59c9a9957da";
const expected = "44c8bd208fa4b1d0588821345a5b84eb521619acf7ecaf6eddabd1a79e63c0be";
const repo = process.env.KALADA_REPO;
assert.ok(repo, "KALADA_REPO must point at a git repository containing the pinned commit");
assert.equal(execFileSync("git", ["rev-parse", `${commit}^{commit}`], { cwd: repo, encoding: "utf8" }).trim(), commit);
const base = join(root, "node_modules/.cache/kalada-preflight");
mkdirSync(base, { recursive: true });
const runDir = mkdtempSync(join(base, "formbar-316-forensic-"));
const runEnv = {
	...process.env,
	TMPDIR: join(runDir, "tmp"),
	TMP: join(runDir, "tmp"),
	TEMP: join(runDir, "tmp"),
	npm_config_cache: join(runDir, "npm-cache"),
	BUN_INSTALL_CACHE_DIR: join(runDir, "bun-cache"),
};
mkdirSync(runEnv.TMPDIR);
const record = { issue: 316, commit, expected, runDir, attempts: [] };
const save = () => writeFileSync(join(runDir, "metadata.json"), `${JSON.stringify(record, null, 2)}\n`);

function run(command, args, cwd, label, options = {}) {
	try {
		const output = execFileSync(command, args, {
			cwd,
			env: runEnv,
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
			stdio: ["ignore", "pipe", "pipe"],
			...options,
		});
		writeFileSync(join(runDir, `${label}.log`), output);
		return output.trim();
	} catch (error) {
		writeFileSync(join(runDir, `${label}.log`), `${error.stdout ?? ""}\n${error.stderr ?? error.message}`);
		throw error;
	}
}

function digest(bytes) {
	return {
		sha256: createHash("sha256").update(bytes).digest("hex"),
		sha512: createHash("sha512").update(bytes).digest("hex"),
	};
}

function inspect(file, label) {
	const bytes = readFileSync(file);
	const names = run("tar", ["-tzf", file], runDir, `${label}-names`).split("\n");
	const headers = run("tar", ["-tvf", file], runDir, `${label}-headers`);
	const files = names.filter((name) => name !== "package/" && !name.endsWith("/"));
	const entries = files.map((name) => ({
		name,
		...digest(execFileSync("tar", ["-xOf", file, name], { cwd: runDir, maxBuffer: 64 * 1024 * 1024 })),
	}));
	return {
		filename: file.split("/").at(-1),
		bytes: bytes.length,
		...digest(bytes),
		integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
		manifest: JSON.parse(run("tar", ["-xOf", file, "package/package.json"], runDir, `${label}-manifest`)),
		entries,
		headersLog: `${label}-headers.log`,
	};
}

function attempt(index) {
	const directory = join(runDir, `attempt-${index}`);
	const source = join(directory, "candidate");
	mkdirSync(source, { recursive: true });
	const entry = {
		index,
		source,
		commands:
			"overlay: git archive | tar; bun install --frozen-lockfile; bun node_modules/.bin/changeset version; bun run --filter @kalada/{core,syntax,provider-routing} build; npm pack --json --pack-destination",
	};
	record.attempts.push(entry);
	run("bash", ["-c", 'git archive "$1" | tar -x -C "$2"', "--", commit, source], repo, `attempt-${index}-archive`);
	entry.archivedManifests = ["package.json", "packages/core/package.json"].map((name) => ({
		name,
		...digest(readFileSync(join(source, name))),
	}));
	run("bun", ["install", "--frozen-lockfile"], source, `attempt-${index}-install`);
	run("bun", ["node_modules/.bin/changeset", "version"], source, `attempt-${index}-version`);
	entry.versionedManifest = JSON.parse(readFileSync(join(source, "packages/core/package.json"), "utf8"));
	for (const name of ["core", "syntax", "provider-routing"])
		run("bun", ["run", "--filter", `@kalada/${name}`, "build"], source, `attempt-${index}-build-${name}`);
	const destination = index === 1 ? runDir : directory;
	const pack = JSON.parse(
		run(
			"npm",
			["pack", "--json", "--pack-destination", destination],
			join(source, "packages/core"),
			`attempt-${index}-pack`,
		),
	);
	assert.equal(pack.length, 1);
	entry.pack = pack[0];
	const file = join(destination, pack[0].filename);
	entry.archive = inspect(file, `attempt-${index}`);
	assert.equal(entry.archive.manifest.name, "@kalada/core");
	assert.equal(entry.archive.manifest.version, "0.6.0");
	assert.equal(entry.archive.integrity, pack[0].integrity);
	// The second pack is not an authorized replacement artifact; keep its full inventory, not another tgz.
	if (index === 2) rmSync(file);
	save();
}

try {
	record.tools = Object.fromEntries(
		["bun", "npm", "node"].map((tool) => [tool, run(tool, ["--version"], root, `tool-${tool}`)]),
	);
	record.environment = Object.fromEntries(
		[
			"SOURCE_DATE_EPOCH",
			"TZ",
			"LANG",
			"LC_ALL",
			"NODE_ENV",
			"npm_config_registry",
			"npm_config_cache",
			"BUN_INSTALL_CACHE_DIR",
			"TMPDIR",
			"TMP",
			"TEMP",
		]
			.filter((key) => runEnv[key] !== undefined)
			.map((key) => [key, runEnv[key]]),
	);
	record.gitTree = run("git", ["rev-parse", `${commit}^{tree}`], repo, "git-tree");
	record.gitArchiveEntries = run("git", ["ls-tree", "-r", "--long", commit], repo, "git-entries").split("\n").length;
	const old = process.env.KALADA_316_OLD_CORE_TARBALL;
	record.oldArchive = old
		? { path: resolve(old), ...inspect(resolve(old), "old") }
		: "unavailable (no approved existing artifact supplied)";
	save();
	attempt(1);
	attempt(2);
	record.comparison = {
		sha256Equal: record.attempts[0].archive.sha256 === record.attempts[1].archive.sha256,
		entriesEqual:
			JSON.stringify(record.attempts[0].archive.entries) === JSON.stringify(record.attempts[1].archive.entries),
		headersEqual:
			readFileSync(join(runDir, "attempt-1-headers.log"), "utf8") ===
			readFileSync(join(runDir, "attempt-2-headers.log"), "utf8"),
	};
	console.log(
		JSON.stringify({
			runDir,
			expected,
			comparison: record.comparison,
			actual: record.attempts.map((entry) => entry.archive.sha256),
		}),
	);
} catch (error) {
	record.failure = String(error);
	console.error(`Forensic job stopped; evidence retained in ${runDir}: ${error}`);
	process.exitCode = 1;
} finally {
	save();
}
