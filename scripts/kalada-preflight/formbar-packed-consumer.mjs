import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = fileURLToPath(new URL("../../tests/consumers/formbar-kalada-v1/", import.meta.url));
const names = [
	"expressions",
	"core",
	"declarative",
	"fsx-authoring",
	"from-schema",
	"react",
	"arbiter",
	"react-schema",
];
const entries = names.map((name) => `@formbar/${name}`);
const runtimeEntries = [...entries, "@formbar/core/path", "@formbar/core/transforms", "@formbar/core/validation"];
const files = [
	"case.cjs",
	"esm.mjs",
	"cjs.cjs",
	"types.mts",
	"types.cts",
	"hooks.mjs",
	"commit.mjs",
	"native.mjs",
	"recovery.mjs",
	"recovery-case.mjs",
	"repeater.mjs",
	"repeater-case.mjs",
	"repeater-fixture.mjs",
	"sections.mjs",
	"sections-case.mjs",
	"initialization.mjs",
	"initialization-case.mjs",
	"feedback.mjs",
	"feedback-case.mjs",
	"feedback-attempt-case.mjs",
];

function run(command, args, cwd, env) {
	try {
		const output = execFileSync(command, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
		console.log(
			JSON.stringify({ lane: "packed-formbar-consumer", command: [command, ...args], output: output.trim() }),
		);
		return output;
	} catch (error) {
		throw new Error(`${command} ${args.join(" ")}: ${error.stdout ?? ""}\n${error.stderr ?? error.message}`);
	}
}

function pack(source, directory, env) {
	return names.map((name) => {
		const result = JSON.parse(
			run("npm", ["pack", "--json", "--pack-destination", directory], join(source, "packages", name), env),
		)[0];
		assert.equal(result.name, `@formbar/${name}`);
		const file = join(directory, result.filename);
		assert.equal(result.integrity, `sha512-${createHash("sha512").update(readFileSync(file)).digest("base64")}`);
		console.log(
			JSON.stringify({
				lane: "packed-formbar-artifact",
				name: result.name,
				version: result.version,
				sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
				integrity: result.integrity,
			}),
		);
		return file;
	});
}

function verify(directory, source) {
	for (const name of names) {
		const path = join(directory, "node_modules/@formbar", name);
		assert.equal(lstatSync(path).isSymbolicLink(), false);
		assert.equal(realpathSync(path), path);
		const actual = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
		const expected = JSON.parse(readFileSync(join(source, "packages", name, "package.json"), "utf8"));
		assert.equal(actual.version, expected.version);
		assert.deepEqual(actual.exports, expected.exports);
	}
	const require = createRequire(join(directory, "package.json"));
	const declarative = join(directory, "node_modules/@formbar/declarative/package.json");
	const syntax = join(directory, "node_modules/@kalada/syntax/package.json");
	const core = realpathSync(require.resolve("@kalada/core"));
	assert.equal(realpathSync(createRequire(declarative).resolve("@kalada/core")), core);
	assert.equal(realpathSync(createRequire(syntax).resolve("@kalada/core")), core);
	assert.equal(require("@kalada/core/package.json").version, "0.6.0");
	const kuery = join(directory, "node_modules/kuery/package.json");
	assert.notEqual(realpathSync(createRequire(kuery).resolve("@kalada/core")), core);
}

function parity(directory, env, major) {
	for (const specifier of runtimeEntries) {
		const esm = run(
			"node",
			[
				"--input-type=module",
				"-e",
				`import * as entry from ${JSON.stringify(specifier)}; console.log(JSON.stringify(Object.keys(entry).sort()))`,
			],
			directory,
			env,
		);
		const cjs = run(
			"node",
			["-e", `console.log(JSON.stringify(Object.keys(require(${JSON.stringify(specifier)})).sort()))`],
			directory,
			env,
		);
		assert.deepEqual(JSON.parse(esm), JSON.parse(cjs), specifier);
	}
	console.log(
		JSON.stringify({ lane: "packed-formbar-parity", react: major, entries: runtimeEntries.length, result: "passed" }),
	);
}

async function install(args, directory, env) {
	// The scoped registry runs in the overlay process: synchronous npm would deadlock its event loop.
	const child = spawn("npm", args, { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] });
	let output = "";
	for (const stream of [child.stdout, child.stderr])
		stream.on("data", (bytes) => {
			output += bytes;
		});
	const timeout = setTimeout(() => child.kill("SIGKILL"), 120000);
	try {
		const status = await new Promise((resolve, reject) => {
			child.once("error", reject);
			child.once("close", resolve);
		});
		console.log(JSON.stringify({ lane: "packed-formbar-consumer", command: ["npm", ...args], status, output }));
		assert.equal(status, 0, "packed Formbar npm install failed");
	} finally {
		clearTimeout(timeout);
	}
}

async function consumer(source, directory, tarballs, archives, major, env, normalRegistry = false) {
	mkdirSync(directory);
	writeFileSync(join(directory, "package.json"), JSON.stringify({ private: true, type: "module" }));
	if (!normalRegistry) copyFileSync(join(source, ".npmrc"), join(directory, ".npmrc"));
	const versions = major === 18 ? ["18.3.1", "18.3.27", "18.3.7"] : ["19.2.0", "19.2.14", "19.2.3"];
	await install(
		[
			"install",
			...(normalRegistry ? [] : ["--ignore-scripts"]),
			"--no-package-lock",
			"--no-save",
			"--no-audit",
			"--no-fund",
			...tarballs,
			...archives.map(({ file }) => file),
			...(normalRegistry
				? [
						"--registry=https://registry.npmjs.org",
						"@kalada/core@0.6.0",
						"@kalada/syntax@0.1.0",
						"@kalada/provider-routing@0.1.0",
					]
				: []),
			`react@${versions[0]}`,
			`react-dom@${versions[0]}`,
			`@types/react@${versions[1]}`,
			`@types/react-dom@${versions[2]}`,
			"@types/node@22.15.30",
			"typescript@5.7.3",
			"jsdom@26.1.0",
		],
		directory,
		env,
	);
	verify(directory, source);
	prepareFixtures(source, directory, env);
	compileTypes(directory, env);
	parity(directory, env, major);
	runCases(directory, env, major);
}

function prepareFixtures(source, directory, env) {
	for (const file of files) copyFileSync(join(fixtures, file), join(directory, file));
	const fsxFixtures = join(source, "tests/consumers/fsx-authoring");
	for (const file of ["case.mjs", "esm.mjs", "cjs.cjs", "types.mts", "types.cts"])
		copyFileSync(join(fsxFixtures, file), join(directory, `fsx-${file}`));
	for (const [input, target, output] of [
		[join(fsxFixtures, "fixture.ts"), "browser", "fsx-fixture.mjs"],
		[join(fixtures, "feedback-fixture.ts"), "node", "feedback-fixture.mjs"],
		[join(fixtures, "initialization-fixture.ts"), "node", "initialization-fixture.mjs"],
		[join(fixtures, "sections-fixture.ts"), "node", "sections-fixture.mjs"],
	])
		run(
			"bun",
			[
				"build",
				input,
				`--target=${target}`,
				"--format=esm",
				"--packages=external",
				"--outfile",
				join(directory, output),
			],
			source,
			env,
		);
}

function compileTypes(directory, env) {
	run(
		"node",
		[
			"node_modules/typescript/bin/tsc",
			"--noEmit",
			"--strict",
			"--skipLibCheck",
			"false",
			"--module",
			"NodeNext",
			"--moduleResolution",
			"NodeNext",
			"--target",
			"ES2022",
			"--types",
			"node,react,react-dom",
			"types.mts",
			"types.cts",
			"fsx-types.mts",
			"fsx-types.cts",
		],
		directory,
		env,
	);
}

function runCases(directory, env, major) {
	for (const file of ["esm.mjs", "cjs.cjs"]) run("node", [file], directory, env);
	run("node", ["hooks.mjs"], directory, env);
	run("node", ["commit.mjs"], directory, env);
	run("node", ["native.mjs"], directory, env);
	run("node", ["recovery.mjs"], directory, env);
	run("node", ["repeater.mjs"], directory, env);
	run("node", ["sections.mjs"], directory, env);
	run("node", ["initialization.mjs"], directory, env);
	run("node", ["feedback.mjs"], directory, env);
	run("node", ["fsx-esm.mjs"], directory, env);
	run("node", ["fsx-cjs.cjs"], directory, env);
	console.log(
		JSON.stringify({
			lane: "packed-formbar-consumer",
			react: major,
			strictNodeNext: "passed",
			esm: "passed",
			cjs: "passed",
		}),
	);
}

export async function runFormbarPackedConsumer(archives, temp, source, env) {
	const directory = join(temp, "packed-formbar");
	mkdirSync(directory);
	const tarballs = pack(source, directory, env);
	for (const major of [18, 19])
		await consumer(source, join(directory, `react-${major}`), tarballs, archives, major, env);
}

export async function runNormalFormbarPackedConsumer(temp, source, env) {
	const directory = join(temp, "normal-packed-formbar");
	mkdirSync(directory);
	const tarballs = pack(source, directory, env);
	for (const major of [18, 19])
		await consumer(source, join(directory, `react-${major}`), tarballs, [], major, env, true);
}
