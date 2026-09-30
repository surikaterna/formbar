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
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { startRegistry } from "./checkpoint-registry.mjs";

const source = fileURLToPath(new URL("../..", import.meta.url));
const stage = join(source, "dist/kalada-preflight");
assert.match(
	execFileSync("git", ["check-ignore", "-v", "dist/kalada-preflight/408-probe"], { cwd: source, encoding: "utf8" }),
	/^\.gitignore:2:dist\/\s/,
);
mkdirSync(stage, { recursive: true });
const logDirectory = join(source, "dist/kalada-preflight-logs");
mkdirSync(logDirectory, { recursive: true });
const logPath = join(logDirectory, `formbar-408-${Date.now()}-${process.pid}.log`);
const originalLog = console.log.bind(console);
const originalError = console.error.bind(console);
let log = "";
for (const [level, original] of [
	["log", originalLog],
	["error", originalError],
])
	console[level] = (...args) => {
		log += `${args.map(String).join(" ")}\n`;
		original(...args);
		writeFileSync(logPath, log);
	};
console.log(JSON.stringify({ retainedLog: logPath }));
const temp = mkdtempSync(join(stage, "formbar-408-overlay-"));
const tmp = join(temp, "tmp");
mkdirSync(tmp);
const env = {
	...process.env,
	TMPDIR: tmp,
	TMP: tmp,
	TEMP: tmp,
	BUN_INSTALL_CACHE_DIR: join(temp, "bun-cache"),
	npm_config_cache: join(temp, "npm-cache"),
};
const commit = "1ed0ec83a7673dffa2ae3cda062e5c4176b4143a";
const oldIntegrity = "sha512-e0HRQSe+4o9L1rt05VTFHC4v3fWZJcDHm2mLPJfsC3tE0mcdXfpVdlURbgOlh5yjZmc/UsG8wsAkXrt/Xyz+oQ==";
const candidate = [
	[
		"core",
		"0.6.0",
		"44c8bd208fa4b1d0588821345a5b84eb521619acf7ecaf6eddabd1a79e63c0be",
		"sha512-KE+Bkgw04bUrC7S15n0qRdteUYdZ5G7l9s8kP0JKc/0lf8jc9MYPZ7c+5CDne2pmTPUQo+lAfiedx8HTEVoxTg==",
	],
	[
		"syntax",
		"0.1.0",
		"a4ba2c6c935b8ab8708ed159ced0c6580ddfdf2bc60a52057843020209644524",
		"sha512-KTZvBKqLQmheP15VHNY9OzOAZS+QAS4EckuOR87av1gRnfk26VaZgf0OnbnFsmzpGXdJLDMO1VC1j8OFRWtExw==",
	],
	[
		"provider-routing",
		"0.1.0",
		"086b20a7d85af5e261b4e2c9d27529d0f765a49ead2f764b97121c50bf84e2f9",
		"sha512-R+i+4MzyKC70859QpfZHzDWYtA6OFvCp35Ncn5kBb/qkhpWBSbhH1jnnJO85WVarjQSJIg3j0r1We0lkaNQVyg==",
	],
];
const inputs = ["package.json", "packages/declarative/package.json", "bun.lock"];
const manifests = ["packages", "apps"].flatMap((group) =>
	readdirSync(join(source, group), { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(source, group, entry.name, "package.json")))
		.map((entry) => `${group}/${entry.name}/package.json`),
);

function sha(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}
function sri(bytes) {
	return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}
function run(command, args, cwd = source, options = {}) {
	const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 300000, ...options });
	console.log(
		JSON.stringify({
			command: [command, ...args],
			cwd: relative(source, cwd),
			status: result.status,
			stdout: result.stdout,
			stderr: result.stderr,
		}),
	);
	if (result.error || result.status !== 0)
		throw result.error ?? new Error(`${command} ${args.join(" ")} exited ${result.status}`);
	return result.stdout.trim();
}
function lane(name, command, args, expected = 0) {
	const result = spawnSync(command, args, { cwd: source, env, encoding: "utf8", timeout: 300000 });
	console.log(
		JSON.stringify({
			lane: name,
			command: [command, ...args],
			status: result.status,
			stdout: result.stdout,
			stderr: result.stderr,
		}),
	);
	assert.equal(result.status, expected, `${name} failed`);
	return result;
}
async function install(args, cwd) {
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
		console.log(JSON.stringify({ command: ["bun", "install", ...args], cwd: relative(source, cwd), status, output }));
		assert.equal(status, 0);
	} finally {
		clearTimeout(timeout);
	}
}
function snapshot() {
	const entries = [];
	function walk(path, prefix = "") {
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			if (
				[".git", ".npmrc", "node_modules", "dist", "trees"].includes(entry.name) ||
				entry.name.endsWith(".tsbuildinfo")
			)
				continue;
			const name = join(prefix, entry.name);
			const file = join(path, entry.name);
			assert.ok(!entry.isSymbolicLink(), name);
			if (entry.isDirectory()) walk(file, name);
			else entries.push([name, sha(readFileSync(file))]);
		}
	}
	walk(source);
	return entries.sort(([a], [b]) => a.localeCompare(b));
}
function artifact(file, name, version, integrity, digest) {
	const bytes = readFileSync(file);
	if (digest) assert.equal(sha(bytes), digest, `${name} SHA`);
	assert.equal(sri(bytes), integrity, `${name} SRI`);
	const manifest = JSON.parse(run("tar", ["-xOf", file, "package/package.json"], temp));
	assert.equal(manifest.name, `@kalada/${name}`);
	assert.equal(manifest.version, version);
	assert.deepEqual(manifest.dependencies ?? {}, name === "syntax" ? { "@kalada/core": "^0.6.0" } : {});
	return { file, bytes, manifest, name, version, sha256: sha(bytes), integrity };
}
function resolvePackage(parent, name) {
	const entry = createRequire(join(parent, "package.json")).resolve(name);
	let path = dirname(realpathSync(entry));
	while (path !== dirname(path)) {
		const file = join(path, "package.json");
		if (existsSync(file) && JSON.parse(readFileSync(file, "utf8")).name === name) {
			assert.ok(!lstatSync(path).isSymbolicLink());
			return { path, version: JSON.parse(readFileSync(file, "utf8")).version };
		}
		path = dirname(path);
	}
	throw new Error(`unresolved ${name}`);
}
function graph(directory, artifacts) {
	const lock = readFileSync(join(directory, "bun.lock"), "utf8");
	const core = resolvePackage(join(directory, "packages/declarative"), "@kalada/core");
	const syntax = resolvePackage(directory, "@kalada/syntax");
	const syntaxCore = resolvePackage(syntax.path, "@kalada/core");
	const kuery = resolvePackage(join(directory, "packages/expressions"), "kuery");
	const old = resolvePackage(kuery.path, "@kalada/core");
	assert.equal(core.version, "0.6.0");
	assert.equal(syntaxCore.path, core.path);
	assert.equal(old.version, "0.1.0");
	assert.notEqual(old.path, core.path);
	for (const { name, version, integrity } of artifacts) {
		const path = join(directory, "node_modules/@kalada", name);
		assert.ok(!lstatSync(path).isSymbolicLink());
		assert.equal(JSON.parse(readFileSync(join(path, "package.json"))).version, version);
		assert.ok(
			lock
				.split("\n")
				.some(
					(line) =>
						line.includes(`/@kalada/${name}/-/${name}-${version}.tgz`) &&
						line.includes(integrity) &&
						line.includes("127.0.0.1"),
				),
		);
	}
	assert.ok(lock.split("\n").some((line) => line.includes("/core-0.1.0.tgz") && line.includes(oldIntegrity)));
	console.log(
		JSON.stringify({ lane: "physical-graph", directory: relative(source, directory), core, syntaxCore, old }),
	);
	return { core, old };
}
function writeOwned(path, bytes) {
	const file = join(source, path);
	assert.deepEqual(readFileSync(file), changed.get(path) ?? original.get(path), `${path}: concurrent edit`);
	changed.set(path, Buffer.from(bytes));
	writeFileSync(file, bytes);
}
function manifest(path, edit) {
	const data = JSON.parse(readFileSync(join(source, path), "utf8"));
	edit(data);
	const bytes = run("bun", ["x", "biome", "format", "--stdin-file-path", path], source, {
		input: JSON.stringify(data, null, 2),
	});
	writeOwned(path, `${bytes}\n`);
}
function packed(artifacts) {
	const directory = join(temp, "packed-consumer");
	mkdirSync(directory);
	writeFileSync(join(directory, "package.json"), JSON.stringify({ private: true, type: "module" }));
	const cache = join(directory, "npm-cache");
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
			...artifacts.map(({ file }) => file),
		],
		directory,
	);
	for (const { name, version } of artifacts) {
		const path = join(directory, "node_modules/@kalada", name);
		assert.ok(!lstatSync(path).isSymbolicLink());
		assert.equal(JSON.parse(readFileSync(join(path, "package.json"))).version, version);
	}
	const fixtureDirectory = join(source, "tests/consumers/kalada-preflight");
	for (const name of ["admission.mjs", "boundary.mjs", "candidate.mjs", "cjs.cjs", "types.mts", "types.cts"])
		copyFileSync(join(fixtureDirectory, name), join(directory, name));
	run("node", ["admission.mjs", "candidate"], directory);
	run("node", ["cjs.cjs", "candidate"], directory);
	run(
		"node",
		[
			join(source, "node_modules/typescript/bin/tsc"),
			"--noEmit",
			"--strict",
			"--module",
			"NodeNext",
			"--moduleResolution",
			"NodeNext",
			"--target",
			"ES2022",
			"types.mts",
			"types.cts",
		],
		directory,
	);
}

let original;
let changed;
let before;
let server;
let registryConfig;
let failure;
let candidateInstalled = false;
const requests = [];
try {
	if (process.env.KALADA_408_FAIL_AFTER_MKDTEMP === "1") throw new Error("injected 408 cleanup");
	assert.equal(run("git", ["rev-parse", "--abbrev-ref", "HEAD"]), "feature/408-host-lifecycle-checkpoint");
	assert.equal(run("git", ["rev-parse", "HEAD"]), "d6de555a024053d835827bb4501c63d5cca50da2");
	assert.equal(realpathSync(source), "/home/sprawl/projects/formbar/trees/408-host-lifecycle-checkpoint");
	const repo = process.env.KALADA_REPO;
	assert.ok(repo);
	assert.equal(run("git", ["rev-parse", `${commit}^{commit}`], repo), commit);
	assert.ok(!existsSync(join(source, ".npmrc")));
	for (const path of inputs) {
		assert.ok(!lstatSync(join(source, path)).isSymbolicLink());
		assert.equal(run("git", ["diff", "--name-only", "HEAD", "--", path]), "");
	}
	before = snapshot();
	original = new Map(inputs.map((path) => [path, readFileSync(join(source, path))]));
	console.log(
		JSON.stringify({ sourceBefore: sha(JSON.stringify(before)), baselineLock: sha(original.get("bun.lock")) }),
	);
	const archive = join(temp, "candidate-source");
	mkdirSync(archive);
	run("bash", ["-c", 'git archive "$1" | tar -x -C "$2"', "--", commit, archive], repo);
	run("bun", ["install", "--frozen-lockfile"], archive);
	run("bun", ["node_modules/.bin/changeset", "version"], archive);
	for (const [name] of candidate) run("bun", ["run", "--filter", `@kalada/${name}`, "build"], archive);
	const artifacts = candidate.map(([name, version, digest, integrity]) => {
		const [{ filename }] = JSON.parse(
			run("npm", ["pack", "--json", "--pack-destination", temp], join(archive, "packages", name)),
		);
		return artifact(join(temp, filename), name, version, integrity, digest);
	});
	assert.ok(readFileSync(join(source, "bun.lock"), "utf8").includes(oldIntegrity));
	assert.equal(run("npm", ["view", "@kalada/core@0.1.0", "dist.integrity"], temp), oldIntegrity);
	const [{ filename }] = JSON.parse(
		run("npm", ["pack", "@kalada/core@0.1.0", "--json", "--pack-destination", temp], temp),
	);
	const old = artifact(join(temp, filename), "core", "0.1.0", oldIntegrity);
	console.log(
		JSON.stringify({
			artifacts: [...artifacts, old].map(({ name, version, sha256, integrity }) => ({
				name,
				version,
				sha256,
				integrity,
			})),
		}),
	);
	await install(
		["--frozen-lockfile", "--ignore-scripts", "--backend", "copyfile", "--registry", "https://registry.npmjs.org"],
		source,
	);
	assert.deepEqual(readFileSync(join(source, "bun.lock")), original.get("bun.lock"));
	server = await startRegistry([...artifacts, old], requests);
	registryConfig = `@kalada:registry=${server.url}\n`;
	writeFileSync(join(source, ".npmrc"), registryConfig);
	changed = new Map();
	manifest("packages/declarative/package.json", (data) => {
		data.dependencies["@kalada/core"] = "0.6.0";
	});
	if (process.env.KALADA_408_FAIL_AFTER_MANIFEST === "1") throw new Error("injected 408 manifest cleanup");
	manifest("package.json", (data) => {
		data.devDependencies["@kalada/syntax"] = "0.1.0";
		data.devDependencies["@kalada/provider-routing"] = "0.1.0";
	});
	server.setPhase("candidate-install");
	try {
		await install(["--ignore-scripts", "--backend", "copyfile", "--registry", "https://registry.npmjs.org"], source);
	} finally {
		if (!readFileSync(join(source, "bun.lock")).equals(original.get("bun.lock")))
			changed.set("bun.lock", readFileSync(join(source, "bun.lock")));
	}
	const installed = graph(source, artifacts);
	candidateInstalled = true;
	server.setPhase("clean-frozen");
	const clean = join(temp, "clean-frozen");
	mkdirSync(clean);
	for (const path of ["package.json", "bun.lock", ...manifests]) {
		const dest = join(clean, path);
		mkdirSync(dirname(dest), { recursive: true });
		copyFileSync(join(source, path), dest);
	}
	copyFileSync(join(source, ".npmrc"), join(clean, ".npmrc"));
	const frozenLock = readFileSync(join(clean, "bun.lock"));
	await install(
		["--frozen-lockfile", "--ignore-scripts", "--backend", "copyfile", "--registry", "https://registry.npmjs.org"],
		clean,
	);
	assert.deepEqual(readFileSync(join(clean, "bun.lock")), frozenLock);
	const frozen = graph(clean, artifacts);
	assert.notEqual(frozen.core.path, installed.core.path);
	assert.notEqual(frozen.old.path, installed.old.path);
	assert.ok(requests.every(({ status }) => status === 200));
	lane("candidate-focused", "bun", [
		"x",
		"vitest",
		"run",
		"--config",
		"scripts/kalada-preflight/overlay.vitest.config.ts",
	]);
	lane("candidate-typecheck", "bun", ["run", "--filter", "@formbar/declarative", "build"]);
	lane("candidate-full", "bun", [
		"x",
		"vitest",
		"run",
		"--exclude",
		"packages/declarative/src/__tests__/public-api.test.ts",
	]);
	lane("candidate-lint", "bun", ["run", "lint"]);
	lane("candidate-build", "bun", ["run", "build"]);
	packed(artifacts);
	console.log(JSON.stringify({ issue: 408, subset: "private-only", sourceSha256: sha(JSON.stringify(before)) }));
} catch (error) {
	failure = error;
} finally {
	console.log(JSON.stringify({ registryRequests: requests }));
	try {
		if (server) await server.close();
	} catch (error) {
		failure ??= error;
	}
	try {
		if (registryConfig) {
			assert.equal(readFileSync(join(source, ".npmrc"), "utf8"), registryConfig);
			rmSync(join(source, ".npmrc"));
		}
		if (changed)
			for (const [path, bytes] of changed) {
				assert.deepEqual(readFileSync(join(source, path)), bytes, `${path}: concurrent edit; refusing restore`);
				writeFileSync(join(source, path), original.get(path));
			}
		if (original) for (const [path, bytes] of original) assert.deepEqual(readFileSync(join(source, path)), bytes);
		if (before) {
			const after = snapshot();
			assert.deepEqual(after, before);
			console.log(
				JSON.stringify({
					sourceBefore: sha(JSON.stringify(before)),
					sourceAfter: sha(JSON.stringify(after)),
					lockSha256: sha(readFileSync(join(source, "bun.lock"))),
					npmrc: "removed",
				}),
			);
		}
		if (candidateInstalled) {
			await install(
				["--frozen-lockfile", "--ignore-scripts", "--backend", "copyfile", "--registry", "https://registry.npmjs.org"],
				source,
			);
			assert.deepEqual(readFileSync(join(source, "bun.lock")), original.get("bun.lock"));
			lane("baseline-unfiltered", "bun", ["run", "test"]);
		}
	} catch (error) {
		failure ??= error;
		console.error("restoration/baseline failure", error);
	}
	try {
		rmSync(temp, { recursive: true, force: true });
	} catch (error) {
		failure ??= error;
	}
}
if (failure) {
	console.error(failure.stack ?? String(failure));
	process.exitCode = 1;
}
originalLog(JSON.stringify({ retainedLog: logPath, logSha256: sha(log) }));
