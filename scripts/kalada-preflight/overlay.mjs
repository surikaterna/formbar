import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBaselineTest } from "./baseline-test.mjs";
import { runFormbarPackedConsumer } from "./formbar-packed-consumer.mjs";
import { startRegistry } from "./local-registry.mjs";
import { runPackedConsumer } from "./packed-consumer.mjs";

const source = fileURLToPath(new URL("../..", import.meta.url));
const staging = join(source, "dist/kalada-preflight");
assert.match(
	execFileSync("git", ["check-ignore", "-v", "dist/kalada-preflight/formbar-316-overlay-probe"], {
		cwd: source,
		encoding: "utf8",
	}),
	/^\.gitignore:2:dist\/\s/,
);
mkdirSync(staging, { recursive: true });
const logBase = join(source, "dist/kalada-preflight-logs");
mkdirSync(logBase, { recursive: true });
const logPath = join(logBase, `formbar-316-overlay-${Date.now()}-${process.pid}.log`);
const originalLog = console.log.bind(console);
const originalError = console.error.bind(console);
let fullLog = "";
let baselineFailure;
for (const [level, original] of [
	["log", originalLog],
	["error", originalError],
])
	console[level] = (...args) => {
		const line = args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" ");
		fullLog += `${line}\n`;
		original(...args);
		writeFileSync(logPath, fullLog);
	};
console.log(JSON.stringify({ retainedLog: logPath }));
const temp = mkdtempSync(join(staging, "formbar-316-overlay-"));
console.log(JSON.stringify({ runTemp: temp }));
const runTmp = join(temp, "tmp");
const bunCache = join(temp, "bun-cache");
mkdirSync(runTmp);
const runEnv = {
	...process.env,
	TMPDIR: runTmp,
	TMP: runTmp,
	TEMP: runTmp,
	npm_config_cache: join(temp, "npm-cache"),
	BUN_INSTALL_CACHE_DIR: bunCache,
};
const commit = "1ed0ec83a7673dffa2ae3cda062e5c4176b4143a";
const excluded = new Set([".git", ".npmrc", "trees", "node_modules", "dist"]);
const inputs = ["package.json", "packages/declarative/package.json", "packages/fsx-authoring/package.json", "bun.lock"];
const workspaceManifests = ["packages", "apps"].flatMap((group) =>
	readdirSync(join(source, group), { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(source, group, entry.name, "package.json")))
		.map((entry) => `${group}/${entry.name}/package.json`),
);
const publishedIntegrity =
	"sha512-e0HRQSe+4o9L1rt05VTFHC4v3fWZJcDHm2mLPJfsC3tE0mcdXfpVdlURbgOlh5yjZmc/UsG8wsAkXrt/Xyz+oQ==";
const packages = [
	["core", "0.6.0"],
	["syntax", "0.1.0"],
	["provider-routing", "0.1.0"],
];
// SHA256s from #302's pinned, locally built Changesets packs (not registry packages).
const pinnedHashes = {
	core: "44c8bd208fa4b1d0588821345a5b84eb521619acf7ecaf6eddabd1a79e63c0be",
	syntax: "a4ba2c6c935b8ab8708ed159ced0c6580ddfdf2bc60a52057843020209644524",
	"provider-routing": "086b20a7d85af5e261b4e2c9d27529d0f765a49ead2f764b97121c50bf84e2f9",
};
const pinnedIntegrity = {
	core: "sha512-KE+Bkgw04bUrC7S15n0qRdteUYdZ5G7l9s8kP0JKc/0lf8jc9MYPZ7c+5CDne2pmTPUQo+lAfiedx8HTEVoxTg==",
	syntax: "sha512-KTZvBKqLQmheP15VHNY9OzOAZS+QAS4EckuOR87av1gRnfk26VaZgf0OnbnFsmzpGXdJLDMO1VC1j8OFRWtExw==",
	"provider-routing": "sha512-R+i+4MzyKC70859QpfZHzDWYtA6OFvCp35Ncn5kBb/qkhpWBSbhH1jnnJO85WVarjQSJIg3j0r1We0lkaNQVyg==",
};

function run(command, args, cwd, env = runEnv) {
	try {
		return execFileSync(command, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	} catch (error) {
		throw new Error(`${command} ${args.join(" ")} failed: ${error.stdout ?? ""}\n${error.stderr ?? error.message}`);
	}
}

function testLane(lane, command, args) {
	console.log(JSON.stringify({ lane, command: [command, ...args] }));
	const result = spawnSync(command, args, { cwd: source, env: runEnv, encoding: "utf8", timeout: 300000 });
	console.log(
		JSON.stringify({
			lane,
			status: result.status,
			signal: result.signal,
			stdout: result.stdout,
			stderr: result.stderr,
		}),
	);
	if (lane === "candidate-FOCUSED" && result.status === 0 && process.env.KALADA_376_PRIMITIVE_FOCUSED !== "1") {
		assert.match(
			result.stdout,
			/scripts\/kalada-preflight\/fixtures\/kalada-policy-integration\.test\.ts \(10 tests\)/,
		);
		assert.match(result.stdout, /kalada-private-runtime\.test\.ts/);
		assert.match(result.stdout, /prepared-definition\.test\.ts \(5 tests\)/);
		assert.match(result.stdout, /prepared-runtime\.test\.ts \(7 tests\)/);
		assert.match(result.stdout, /kalada-generated-react\.test\.tsx \(3 tests\)/);
		assert.match(result.stdout, /kalada-public-react\.test\.tsx \(3 tests\)/);
		assert.match(result.stdout, /repeater-write-proof\.test\.ts \(18 tests\)/);
	}
	if (result.status !== 0 || result.error) {
		if (lane === "baseline-unfiltered")
			baselineFailure = { status: result.status, output: `${result.stdout}\n${result.stderr}` };
		const logBase = join(source, "dist/kalada-preflight-logs");
		assert.match(
			execFileSync("git", ["check-ignore", "-v", "dist/kalada-preflight-logs/probe"], {
				cwd: source,
				encoding: "utf8",
			}),
			/^\.gitignore:2:dist\/\s/,
		);
		mkdirSync(logBase, { recursive: true });
		const logDir = mkdtempSync(join(logBase, "formbar-316-failed-"));
		writeFileSync(join(logDir, "stdout.log"), result.stdout ?? "");
		writeFileSync(join(logDir, "stderr.log"), result.stderr ?? String(result.error ?? ""));
		writeFileSync(
			join(logDir, "command.json"),
			JSON.stringify({ lane, command: [command, ...args], status: result.status, signal: result.signal }),
		);
		console.error(JSON.stringify({ failedLaneLogs: logDir }));
	}
	if (result.error) throw result.error;
	return result.status;
}

function hash(file) {
	return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function sri(bytes) {
	return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

async function install(args, cwd, env = runEnv) {
	const child = spawn("bun", ["install", ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
	let output = "";
	for (const stream of [child.stdout, child.stderr])
		stream.on("data", (chunk) => {
			output += chunk;
		});
	const timeout = setTimeout(() => child.kill("SIGKILL"), 120000);
	try {
		const status = await new Promise((resolve, reject) => {
			child.once("error", reject);
			child.once("close", resolve);
		});
		console.log(JSON.stringify({ command: ["bun", "install", ...args], status, output: output.trim() }));
		assert.equal(status, 0, "bun install failed");
	} finally {
		clearTimeout(timeout);
	}
}

function snapshot(directory) {
	const entries = [];
	function walk(path, relative = "") {
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			if (excluded.has(entry.name) || entry.name.endsWith(".tsbuildinfo")) continue;
			const name = join(relative, entry.name);
			const file = join(path, entry.name);
			assert.ok(!entry.isSymbolicLink(), `source symlink: ${name}`);
			if (entry.isDirectory()) walk(file, name);
			else entries.push([name, hash(file)]);
		}
	}
	walk(directory);
	return entries.sort(([a], [b]) => a.localeCompare(b));
}

function resolvedPackage(parent, name) {
	const entry = createRequire(join(parent, "package.json")).resolve(name);
	let directory = dirname(realpathSync(entry));
	while (directory !== dirname(directory)) {
		const manifest = join(directory, "package.json");
		if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name === name) {
			assert.ok(!lstatSync(directory).isSymbolicLink(), `${name}: linked package`);
			return { path: directory, manifest: JSON.parse(readFileSync(manifest, "utf8")) };
		}
		directory = dirname(directory);
	}
	throw new Error(`${name}: package manifest not found for ${entry}`);
}

function verifyArchives(temp, repo) {
	const supplied = packages.map(
		([name]) => process.env[`KALADA_316_${name.toUpperCase().replaceAll("-", "_")}_TARBALL`],
	);
	assert.ok(supplied.every(Boolean) || supplied.every((file) => !file), "supply all three archives or none");
	let candidate;
	if (supplied.every((file) => !file)) {
		candidate = join(temp, "candidate");
		mkdirSync(candidate);
		run("bash", ["-c", 'git archive "$1" | tar -x -C "$2"', "--", commit, candidate], repo);
		run("bun", ["install", "--frozen-lockfile"], candidate);
		run("bun", ["node_modules/.bin/changeset", "version"], candidate);
		for (const [name] of packages) run("bun", ["run", "--filter", `@kalada/${name}`, "build"], candidate);
	}
	const archives = [];
	for (const [index, [name, version]] of packages.entries()) {
		const file = candidate
			? join(
					temp,
					JSON.parse(run("npm", ["pack", "--json", "--pack-destination", temp], join(candidate, "packages", name)))[0]
						.filename,
				)
			: resolve(supplied[index]);
		const expected = pinnedHashes[name];
		assert.equal(hash(file), expected, `${name}: wrong archive hash`);
		assert.equal(sri(readFileSync(file)), pinnedIntegrity[name], `${name}: wrong archive integrity`);
		const manifest = JSON.parse(run("tar", ["-xOf", file, "package/package.json"], temp));
		assert.equal(manifest.name, `@kalada/${name}`);
		assert.equal(manifest.version, version);
		assert.deepEqual(manifest.dependencies ?? {}, name === "syntax" ? { "@kalada/core": "^0.6.0" } : {});
		archives.push({
			name,
			version,
			file,
			bytes: readFileSync(file),
			manifest,
			sha256: expected,
			integrity: sri(readFileSync(file)),
		});
	}
	return archives;
}

function publishedCore(temp, source) {
	assert.ok(readFileSync(join(source, "bun.lock"), "utf8").includes(publishedIntegrity));
	assert.equal(run("npm", ["view", "@kalada/core@0.1.0", "dist.integrity"], temp), publishedIntegrity);
	const filename = JSON.parse(run("npm", ["pack", "@kalada/core@0.1.0", "--json", "--pack-destination", temp], temp))[0]
		.filename;
	const file = join(temp, filename);
	const bytes = readFileSync(file);
	assert.equal(sri(bytes), publishedIntegrity, "published core disagrees with registry and Formbar lock");
	const manifest = JSON.parse(run("tar", ["-xOf", file, "package/package.json"], temp));
	assert.equal(manifest.name, "@kalada/core");
	assert.equal(manifest.version, "0.1.0");
	return { name: "core", version: "0.1.0", file, bytes, manifest, sha256: hash(file), integrity: publishedIntegrity };
}

function writeOwned(path, bytes) {
	const file = join(source, path);
	assert.deepEqual(readFileSync(file), modified.get(path) ?? original.get(path), `${path}: concurrent edit`);
	modified.set(path, Buffer.from(bytes));
	writeFileSync(file, bytes);
}

function formattedManifest(path, value) {
	const result = spawnSync("bun", ["x", "biome", "format", "--stdin-file-path", path], {
		cwd: source,
		env: runEnv,
		input: JSON.stringify(value, null, 2),
		encoding: "utf8",
	});
	assert.equal(result.status, 0, `biome format failed: ${result.stderr}`);
	return result.stdout;
}

function checkGraph(directory, archives) {
	const lock = readFileSync(join(directory, "bun.lock"), "utf8");
	const candidateCore = resolvedPackage(join(directory, "packages/declarative"), "@kalada/core");
	const syntax = resolvedPackage(directory, "@kalada/syntax");
	const syntaxCore = resolvedPackage(syntax.path, "@kalada/core");
	const authoring = join(directory, "packages/fsx-authoring");
	assert.equal(resolvedPackage(authoring, "@kalada/core").path, candidateCore.path);
	assert.equal(resolvedPackage(authoring, "@kalada/syntax").path, syntax.path);
	assert.equal(resolvedPackage(authoring, "@kalada/provider-routing").manifest.version, "0.1.0");
	const kuery = resolvedPackage(join(directory, "packages/expressions"), "kuery");
	const lockedCore = resolvedPackage(kuery.path, "@kalada/core");
	assert.equal(candidateCore.manifest.version, "0.6.0");
	assert.equal(syntaxCore.manifest.version, "0.6.0");
	assert.equal(syntaxCore.path, candidateCore.path);
	assert.equal(kuery.manifest.version, "2.1.1");
	assert.equal(lockedCore.manifest.version, "0.1.0");
	assert.notEqual(candidateCore.path, lockedCore.path, "candidate and locked core share a physical path");
	assert.equal(candidateCore.path, realpathSync(join(directory, "node_modules/@kalada/core")));
	console.log(
		JSON.stringify({
			declarativeCore: candidateCore.path,
			syntaxCore: syntaxCore.path,
			kuery: kuery.path,
			kueryCore: lockedCore.path,
		}),
	);
	for (const { name, version, sha256, integrity } of archives) {
		const path = join(directory, "node_modules", "@kalada", name);
		assert.ok(existsSync(path) && !lstatSync(path).isSymbolicLink(), `${name}: missing or workspace link`);
		const actual = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
		assert.equal(actual.name, `@kalada/${name}`);
		assert.equal(actual.version, version);
		const entries = lock.split("\n").filter((line) => line.includes(`"@kalada/${name}": [`));
		assert.ok(
			entries.length &&
				entries.some(
					(line) =>
						line.includes(`/@kalada/${name}/-/${name}-${version}.tgz`) &&
						line.includes(integrity) &&
						line.includes("127.0.0.1"),
				),
			`${name}: archive absent from lock`,
		);
		console.log(
			JSON.stringify({
				installed: actual.name,
				version: actual.version,
				path: realpathSync(path),
				archiveSha256: sha256,
				lock: entries,
			}),
		);
	}
	assert.ok(lock.includes(publishedIntegrity), "kuery locked core integrity missing");
	assert.ok(
		lock
			.split("\n")
			.some(
				(line) => line.includes("/core-0.1.0.tgz") && line.includes("127.0.0.1") && line.includes(publishedIntegrity),
			),
		"published core localhost archive missing",
	);
	console.log(
		JSON.stringify({ publishedCoreLock: lock.split("\n").filter((line) => line.includes('"@kalada/core@0.1.0"')) }),
	);
	return { candidateCore: candidateCore.path, lockedCore: lockedCore.path };
}

async function checkCleanFrozen(temp, lockBytes, archives, registry, cache, originalGraph) {
	const clean = join(temp, "clean-frozen-workspace");
	mkdirSync(clean);
	for (const path of ["package.json", "bun.lock", ...workspaceManifests]) {
		const from = join(source, path);
		assert.ok(!lstatSync(from).isSymbolicLink(), `${path}: symlink`);
		const destination = join(clean, path);
		mkdirSync(dirname(destination), { recursive: true });
		copyFileSync(from, destination);
		assert.deepEqual(readFileSync(destination), readFileSync(from), `${path}: copy differs`);
		console.log(JSON.stringify({ cleanManifest: path, sha256: hash(from) }));
	}
	assert.deepEqual(readFileSync(join(clean, "bun.lock")), lockBytes);
	copyFileSync(join(source, ".npmrc"), join(clean, ".npmrc"));
	assert.ok(!existsSync(join(clean, "node_modules")), "clean graph is not empty");
	await install(
		["--frozen-lockfile", "--ignore-scripts", "--backend", "copyfile", "--cache-dir", cache, "--registry", registry],
		clean,
	);
	assert.deepEqual(readFileSync(join(clean, "bun.lock")), lockBytes, "clean frozen install changed lock");
	const graph = checkGraph(clean, archives);
	assert.notEqual(graph.candidateCore, originalGraph.candidateCore, "frozen candidate reuses original physical graph");
	assert.notEqual(graph.lockedCore, originalGraph.lockedCore, "frozen published core reuses original physical graph");
	for (const path of ["package.json", ...workspaceManifests])
		assert.deepEqual(
			readFileSync(join(clean, path)),
			readFileSync(join(source, path)),
			`${path}: install changed manifest`,
		);
	console.log(JSON.stringify({ cleanFrozen: relative(source, clean), lockSha256: hash(join(clean, "bun.lock")) }));
}

const requests = [];
let failure;
let before;
let original;
let modified;
let registryServer;
let wroteRegistryConfig = false;
let registryConfigExpected;
let candidateReady = false;
try {
	if (process.env.KALADA_316_FAIL_AFTER_MKDTEMP === "1") throw new Error("overlay cleanup test failure");
	assert.equal(run("git", ["rev-parse", "--abbrev-ref", "HEAD"], source), "feature/305-fsx-authoring");
	assert.equal(run("git", ["rev-parse", "HEAD"], source), "4879fcc5987095b2f91095d96e6dde1dc9c79e2a");
	assert.equal(
		run("git", ["merge-base", "HEAD", "ee71f85d8b83f005ffd3e37e5ca3220e40af99e6"], source),
		"ee71f85d8b83f005ffd3e37e5ca3220e40af99e6",
		"unexpected Formbar base",
	);
	const repo = process.env.KALADA_REPO;
	assert.ok(repo, "KALADA_REPO required to verify pinned candidate commit");
	assert.equal(run("git", ["rev-parse", `${commit}^{commit}`], repo), commit);
	assert.equal(realpathSync(source), "/home/sprawl/projects/formbar/trees/305-fsx-authoring");
	for (const path of inputs) {
		const file = join(source, path);
		assert.ok(!lstatSync(file).isSymbolicLink(), `${path}: symlink`);
		if (path === "packages/declarative/package.json")
			assert.equal(run("git", ["diff", "--name-only", "HEAD", "--", path], source), "", `${path}: not pristine`);
	}
	assert.ok(!existsSync(join(source, ".npmrc")), "temporary scoped registry config already exists");
	for (const path of inputs.filter((path) => path.endsWith("package.json"))) {
		const manifest = JSON.parse(readFileSync(join(source, path), "utf8"));
		for (const dependencies of [manifest.dependencies, manifest.devDependencies, manifest.peerDependencies])
			assert.ok(
				!Object.keys(dependencies ?? {}).some((name) => name.startsWith("@kalada/")),
				`${path}: permanent Kalada candidate dependency`,
			);
	}
	for (const path of ["node_modules", "packages/declarative/dist", "packages/declarative/tsconfig.tsbuildinfo"]) {
		const file = join(source, path);
		if (!existsSync(file)) continue;
		assert.ok(!lstatSync(file).isSymbolicLink(), `${path}: symlink`);
		assert.equal(
			spawnSync("mountpoint", ["-q", file], { env: runEnv }).status,
			32,
			`${path}: mountpoint or check failed`,
		);
	}
	before = snapshot(source);
	console.log(
		JSON.stringify({
			formbarHeadBefore: run("git", ["rev-parse", "HEAD"], source),
			sourceBefore: createHash("sha256").update(JSON.stringify(before)).digest("hex"),
		}),
	);
	original = new Map(inputs.map((path) => [path, readFileSync(join(source, path))]));
	const archives = verifyArchives(temp, repo);
	const oldCore = publishedCore(temp, source);
	console.log(
		JSON.stringify({
			artifacts: [...archives, oldCore].map(({ name, version, sha256, integrity }) => ({
				name,
				version,
				sha256,
				integrity,
			})),
		}),
	);
	const cache = bunCache;
	const registry = "https://registry.npmjs.org";
	const baselineLock = hash(join(source, "bun.lock"));
	console.log(
		JSON.stringify({
			baselineLockSha256: baselineLock,
			registry,
			cache,
			install: "--frozen-lockfile --ignore-scripts",
		}),
	);
	await install(
		["--frozen-lockfile", "--ignore-scripts", "--backend", "copyfile", "--cache-dir", cache, "--registry", registry],
		source,
	);
	assert.equal(hash(join(source, "bun.lock")), baselineLock, "baseline install changed lock");
	registryServer = await startRegistry([...archives, oldCore], requests);
	wroteRegistryConfig = true;
	registryConfigExpected = `@kalada:registry=${registryServer.url}\n`;
	writeFileSync(join(source, ".npmrc"), registryConfigExpected);
	modified = new Map();
	const manifestPath = join(source, "packages/declarative/package.json");
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	manifest.dependencies["@kalada/core"] = "0.6.0";
	writeOwned("packages/declarative/package.json", formattedManifest("packages/declarative/package.json", manifest));
	const authoringPath = "packages/fsx-authoring/package.json";
	const authoring = JSON.parse(original.get(authoringPath));
	authoring.dependencies["@kalada/core"] = "0.6.0";
	authoring.dependencies["@kalada/syntax"] = "0.1.0";
	authoring.dependencies["@kalada/provider-routing"] = "0.1.0";
	writeOwned(authoringPath, formattedManifest(authoringPath, authoring));
	if (process.env.KALADA_316_FAIL_AFTER_MANIFEST === "1") throw new Error("injected manifest failure");
	const rootPath = join(source, "package.json");
	const root = JSON.parse(readFileSync(rootPath, "utf8"));
	root.devDependencies["@kalada/syntax"] = "0.1.0";
	root.devDependencies["@kalada/provider-routing"] = "0.1.0";
	writeOwned("package.json", formattedManifest("package.json", root));
	registryServer.setPhase("candidate-install");
	try {
		await install(["--ignore-scripts", "--backend", "copyfile", "--cache-dir", cache, "--registry", registry], source);
	} finally {
		// An unsuccessful install may still have rewritten the lock; retain its bytes for guarded restoration.
		if (!readFileSync(join(source, "bun.lock")).equals(original.get("bun.lock")))
			modified.set("bun.lock", readFileSync(join(source, "bun.lock")));
	}
	modified.set("bun.lock", readFileSync(join(source, "bun.lock")));
	const originalGraph = checkGraph(source, archives);
	candidateReady = true;
	registryServer.setPhase("frozen-install");
	await checkCleanFrozen(temp, modified.get("bun.lock"), archives, registry, cache, originalGraph);
	assert.ok(
		requests.every(({ status }) => status === 200),
		"unknown registry request",
	);
	const excludedPolicy = "packages/declarative/src/__tests__/public-api.test.ts";
	assert.equal(
		testLane("candidate-public-4A", "bun", [
			"x",
			"vitest",
			"run",
			"--config",
			"scripts/kalada-preflight/overlay.vitest.config.ts",
			"scripts/kalada-preflight/fixtures/public-admission.test.ts",
		]),
		0,
		"public 4A validation and runtime boundary failed",
	);
	console.log(
		JSON.stringify({ lane: "candidate", excludedPolicy, reason: "asserts no production @kalada/core dependency" }),
	);
	const failedCandidateLanes = [];
	const candidateCommands = [
		["bun", ["run", "--filter", "@formbar/expressions", "build:dist"]],
		["bun", ["run", "--filter", "@formbar/core", "build:dist"]],
		["bun", ["run", "--filter", "@formbar/declarative", "build"]],
		["bun", ["x", "tsc", "-p", "scripts/kalada-preflight/fixtures/kalada-contract.tsconfig.json"]],
		["bun", ["run", "--filter", "@formbar/declarative", "build:dist"]],
		["bun", ["run", "--filter", "@formbar/fsx-authoring", "build"]],
		["bun", ["run", "--filter", "@formbar/fsx-authoring", "build:dist"]],
		["bun", ["run", "--filter", "@formbar/from-schema", "build:dist"]],
		["bun", ["run", "--filter", "@formbar/react", "build:dist"]],
		["bun", ["run", "--filter", "@formbar/react-schema", "build"]],
		["bun", ["run", "--filter", "@formbar/react-schema", "build:dist"]],
		["bun", ["x", "tsc", "-p", "scripts/kalada-preflight/fixtures/component-bridge.tsconfig.json"]],
		["bun", ["x", "vitest", "run", "--config", "scripts/kalada-preflight/overlay.vitest.config.ts"]],
		["bun", ["x", "vitest", "run", "packages/declarative/src/__tests__", "--exclude", excludedPolicy]],
		[
			"bun",
			[
				"x",
				"vitest",
				"run",
				"packages/from-schema/src/__tests__/create-schema-form.test.ts",
				"packages/react-schema/src/__tests__/form-renderer.test.tsx",
				"packages/from-schema/src/__tests__/public-api.test.ts",
				"packages/react-schema/src/__tests__/public-api.test.ts",
			],
		],
		["bun", ["x", "vitest", "run", "--exclude", excludedPolicy]],
		["bun", ["run", "lint"]],
		["bun", ["run", "build"]],
		["bun", ["run", "--filter", "@formbar/demos", "build"]],
	];
	if (process.env.KALADA_305_FOCUSED === "1") {
		candidateCommands.splice(
			0,
			candidateCommands.length,
			["bun", ["run", "--filter", "@formbar/expressions", "build:dist"]],
			["bun", ["run", "--filter", "@formbar/core", "build:dist"]],
			["bun", ["run", "--filter", "@formbar/declarative", "build:dist"]],
			["bun", ["run", "--filter", "@formbar/fsx-authoring", "build"]],
			[
				"bun",
				[
					"x",
					"vitest",
					"run",
					"packages/fsx-authoring/src/__tests__",
					"apps/demos/src/__tests__/kalada-demo-code-principles.test.ts",
				],
			],
		);
	}
	if (process.env.KALADA_376_PRIMITIVE_FOCUSED === "1") {
		const focused = [
			...candidateCommands.slice(0, 3),
			candidateCommands[4],
			candidateCommands[5],
			candidateCommands[6],
			candidateCommands[8],
			[
				"bun",
				[
					"x",
					"vitest",
					"run",
					"--config",
					"scripts/kalada-preflight/overlay.vitest.config.ts",
					"scripts/kalada-preflight/fixtures/primitive-row-location.test.ts",
					"apps/demos/src/__tests__/kalada-demo-host.test.tsx",
					"-t",
					"primitive row|primitive Field",
				],
			],
		];
		candidateCommands.splice(0, candidateCommands.length, ...focused);
	}
	for (const [command, args] of candidateCommands) {
		const focused = args.includes("scripts/kalada-preflight/overlay.vitest.config.ts");
		if (focused)
			console.log(
				JSON.stringify({
					lane: "candidate-FOCUSED",
					fixtures: ["component-bridge.test.tsx", "prepared-runtime.test.ts"],
				}),
			);
		const status = testLane(focused ? "candidate-FOCUSED" : "candidate", command, args);
		if (status !== 0) failedCandidateLanes.push({ command: [command, ...args], status });
		if (args.includes("packages/react-schema/src/__tests__/public-api.test.ts")) {
			const scopedStatus = testLane("candidate-schema-packages", "bun", [
				"x",
				"vitest",
				"run",
				"packages/from-schema/src/__tests__",
				"packages/react-schema/src/__tests__",
			]);
			console.log(JSON.stringify({ lane: "candidate-schema-packages", status: scopedStatus }));
			if (scopedStatus !== 0) failedCandidateLanes.push({ lane: "candidate-schema-packages", status: scopedStatus });
		}
	}
	if (
		failedCandidateLanes.length === 0 &&
		process.env.KALADA_376_PRIMITIVE_FOCUSED !== "1" &&
		process.env.KALADA_305_FOCUSED !== "1"
	) {
		runPackedConsumer(archives, temp, source, runEnv);
		await runFormbarPackedConsumer(archives, temp, source, runEnv);
	} else console.error(JSON.stringify({ failedCandidateLanes, packedConsumer: "blocked by candidate failures" }));
	assert.deepEqual(
		snapshot(source).filter(([path]) => !inputs.includes(path)),
		before.filter(([path]) => !inputs.includes(path)),
		"worktree source or Changeset changed",
	);
	console.log(
		JSON.stringify({
			issue: 305,
			stage:
				process.env.KALADA_305_FOCUSED === "1" ? "focused-authoring-check-only" : "authoring-candidate-ready-for-audit",
			candidate: commit,
			sourceSha256: createHash("sha256").update(JSON.stringify(before)).digest("hex"),
			candidateInstalled: "passed",
		}),
	);
	assert.deepEqual(failedCandidateLanes, [], "candidate lanes failed; inspect retained lane logs");
} catch (error) {
	failure = error;
} finally {
	console.log(JSON.stringify({ privateRequests: requests }));
	try {
		if (registryServer) await registryServer.close();
	} catch (error) {
		failure ??= error;
		console.error("Registry close failed", error);
	}
	const cleanupError = (error) => {
		failure ??= error;
		console.error("Overlay restoration failed", error);
	};
	let restored = false;
	try {
		if (wroteRegistryConfig) {
			assert.ok(!lstatSync(join(source, ".npmrc")).isSymbolicLink());
			assert.equal(readFileSync(join(source, ".npmrc"), "utf8"), registryConfigExpected);
			rmSync(join(source, ".npmrc"));
		}
	} catch (error) {
		cleanupError(error);
	}
	if (modified)
		for (const [path, expected] of modified) {
			try {
				const file = join(source, path);
				assert.equal(
					hash(file),
					createHash("sha256").update(expected).digest("hex"),
					`${path}: concurrent edit; refusing restoration`,
				);
				writeFileSync(file, original.get(path));
			} catch (error) {
				cleanupError(error);
			}
		}
	try {
		if (original)
			for (const [path, bytes] of original)
				assert.deepEqual(readFileSync(join(source, path)), bytes, `${path}: restore failed`);
		if (before) {
			const after = snapshot(source);
			const digest = (entries) => createHash("sha256").update(JSON.stringify(entries)).digest("hex");
			console.log(
				JSON.stringify({
					formbarHeadAfter: run("git", ["rev-parse", "HEAD"], source),
					sourceBefore: digest(before),
					sourceAfter: digest(after),
					changeset: hash(join(source, ".changeset/public-kalada-v1.md")),
					authoringChangeset: hash(join(source, ".changeset/fsx-authoring-candidate.md")),
				}),
			);
			assert.deepEqual(after, before, "worktree source or Changeset changed");
		}
		if (wroteRegistryConfig) assert.ok(!existsSync(join(source, ".npmrc")), "registry config not removed");
		restored = true;
	} catch (error) {
		cleanupError(error);
	}
	if (restored && candidateReady) {
		try {
			console.log(JSON.stringify({ lane: "baseline", registry: "https://registry.npmjs.org", lock: "pristine" }));
			await install(
				["--frozen-lockfile", "--ignore-scripts", "--backend", "copyfile", "--registry", "https://registry.npmjs.org"],
				source,
			);
			assert.deepEqual(
				readFileSync(join(source, "bun.lock")),
				original.get("bun.lock"),
				"baseline reinstall changed lock",
			);
			try {
				runBaselineTest(testLane);
			} catch (error) {
				if (failure) cleanupError(error);
				else {
					assert.equal(baselineFailure?.status, 1, "baseline failure was not captured");
					assert.match(
						baselineFailure.output,
						/The requested module '@kalada\/core' does not provide an export named 'KaladaV1'/,
					);
					assert.match(baselineFailure.output, /No matching export.*compileKaladaV1Program/);
					console.error(
						JSON.stringify({
							issue: 317,
							lane: "baseline-unfiltered",
							result: "FAILED",
							reason: "published core 0.1 lacks the candidate V1 exports; production merge HOLD",
						}),
					);
				}
			}
		} catch (error) {
			cleanupError(error);
		}
	}
	try {
		rmSync(temp, { recursive: true, force: true });
	} catch (error) {
		failure ??= error;
		console.error("Overlay cleanup failed", error);
	}
}
if (failure) {
	console.error(failure.stack ?? String(failure));
	process.exitCode = 1;
}
originalLog(JSON.stringify({ retainedLog: logPath, logSha256: createHash("sha256").update(fullLog).digest("hex") }));
