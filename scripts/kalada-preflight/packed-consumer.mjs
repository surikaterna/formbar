import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = fileURLToPath(new URL("../../tests/consumers/kalada-preflight/", import.meta.url));
const names = ["admission.mjs", "boundary.mjs", "candidate.mjs", "cjs.cjs", "types.mts", "types.cts"];

function run(command, args, cwd, env) {
	try {
		const output = execFileSync(command, args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
		console.log(JSON.stringify({ lane: "packed-consumer", command: [command, ...args], output: output.trim() }));
	} catch (error) {
		console.error(
			JSON.stringify({
				lane: "packed-consumer",
				command: [command, ...args],
				stdout: String(error.stdout),
				stderr: String(error.stderr),
			}),
		);
		throw error;
	}
}

export function runPackedConsumer(archives, temp, source, env) {
	const directory = join(temp, "packed-consumer");
	mkdirSync(directory);
	writeFileSync(join(directory, "package.json"), JSON.stringify({ private: true, type: "module" }));
	const cache = join(directory, "npm-cache");
	mkdirSync(cache);
	for (const artifact of archives) {
		assert.equal(createHash("sha256").update(readFileSync(artifact.file)).digest("hex"), artifact.sha256);
		assert.equal(
			`sha512-${createHash("sha512").update(readFileSync(artifact.file)).digest("base64")}`,
			artifact.integrity,
		);
	}
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
			...archives.map(({ file }) => file),
		],
		directory,
		env,
	);
	for (const { name, version, manifest } of archives) {
		const path = join(directory, "node_modules", "@kalada", name);
		assert.equal(lstatSync(path).isSymbolicLink(), false, `${name}: linked package`);
		assert.equal(realpathSync(path), path, `${name}: package escaped isolated install`);
		const installed = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
		assert.equal(installed.name, manifest.name);
		assert.equal(installed.version, version);
		assert.deepEqual(installed.dependencies ?? {}, manifest.dependencies ?? {});
		console.log(JSON.stringify({ lane: "packed-consumer", installed: installed.name, version }));
	}
	const syntax = join(directory, "node_modules/@kalada/syntax");
	const core = join(directory, "node_modules/@kalada/core");
	assert.equal(
		realpathSync(createRequire(join(syntax, "package.json")).resolve("@kalada/core")),
		realpathSync(createRequire(join(core, "package.json")).resolve("@kalada/core")),
	);
	for (const name of names) copyFileSync(join(fixtures, name), join(directory, name));
	run("node", ["admission.mjs", "candidate"], directory, env);
	run("node", ["cjs.cjs", "candidate"], directory, env);
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
		env,
	);
}
