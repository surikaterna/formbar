import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const fixtures = fileURLToPath(new URL("./fixtures/", import.meta.url));
const names = ["expressions", "core", "declarative", "from-schema", "react", "arbiter", "react-schema"];
// Frozen #154 coverage: never infer the public surface from the manifests under test.
const specifiers = [
	"@formbar/expressions",
	"@formbar/core",
	"@formbar/core/path",
	"@formbar/core/transforms",
	"@formbar/core/validation",
	"@formbar/declarative",
	"@formbar/from-schema",
	"@formbar/react",
	"@formbar/arbiter",
	"@formbar/react-schema",
];
const peerSpecifiers = ["@arbitre/core", "kuery", "kuery/expression"];
const temporary = mkdtempSync(resolve(tmpdir(), "formbar-consumer-154-"));

function npm(args, cwd) {
	return execFileSync("npm", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
}

function installTarballs() {
	const tarballs = names.map((name) => {
		const output = JSON.parse(
			npm(["pack", "--json", "--pack-destination", temporary], resolve(root, "packages", name)),
		);
		const tarball = resolve(temporary, output[0].filename);
		assert.equal(output[0].name, `@formbar/${name}`);
		assert.equal(output[0].integrity, `sha512-${createHash("sha512").update(readFileSync(tarball)).digest("base64")}`);
		return tarball;
	});
	return tarballs;
}

function verifyInstalledPacks(directory) {
	for (const name of names) {
		const installed = resolve(directory, "node_modules", "@formbar", name);
		assert.equal(lstatSync(installed).isSymbolicLink(), false, `${name}: workspace link`);
		const manifest = JSON.parse(readFileSync(resolve(installed, "package.json"), "utf8"));
		const packed = JSON.parse(readFileSync(resolve(root, "packages", name, "package.json"), "utf8"));
		assert.equal(manifest.name, `@formbar/${name}`);
		assert.deepEqual(manifest.exports, packed.exports);
		assert.equal(manifest.version, packed.version);
	}
	for (const [name, version] of [
		["@arbitre/core", "0.3.1"],
		["kuery", "2.1.1"],
		["@kalada/core", "0.1.0"],
	]) {
		const parent = name === "@kalada/core" ? resolve(directory, "node_modules", "kuery") : directory;
		const manifest = JSON.parse(readFileSync(resolve(parent, "node_modules", name, "package.json"), "utf8"));
		assert.equal(manifest.version, version, `${name}: upstream dependency version`);
	}
}

function verifyResolution(ts, options, directory, path, extension, specifier) {
	const mode = extension === "cts" ? ts.ModuleKind.CommonJS : ts.ModuleKind.ESNext;
	const result = ts.resolveModuleName(specifier, path, options, ts.sys, undefined, undefined, mode).resolvedModule;
	assert.ok(result, `${path}: ${specifier} did not resolve`);
	assert.ok(result.resolvedFileName.startsWith(`${resolve(directory, "node_modules")}/`));
	assert.ok(
		result.resolvedFileName.endsWith(extension === "cts" ? ".d.cts" : ".d.ts"),
		`${path}: ${specifier} resolved ${result.resolvedFileName}`,
	);
	return result.resolvedFileName;
}

function compile(directory, fixture, moduleKind, resolution, extension) {
	const require = createRequire(resolve(directory, "package.json"));
	const ts = require("typescript");
	assert.equal(ts.version, "5.7.3");
	const path = resolve(directory, `fixture.${extension}`);
	writeFileSync(path, readFileSync(resolve(fixtures, fixture)));
	const options = {
		strict: true,
		skipLibCheck: false,
		noEmit: true,
		module: ts.ModuleKind[moduleKind],
		moduleResolution: ts.ModuleResolutionKind[resolution],
		target: ts.ScriptTarget.ES2022,
		jsx: ts.JsxEmit.ReactJSX,
		types: ["node", "react", "react-dom"],
	};
	const program = ts.createProgram([path], options);
	const diagnostics = ts.getPreEmitDiagnostics(program);
	assert.equal(
		diagnostics.length,
		0,
		ts.formatDiagnosticsWithColorAndContext(diagnostics, {
			getCanonicalFileName: (name) => name,
			getCurrentDirectory: () => directory,
			getNewLine: () => "\n",
		}),
	);
	for (const specifier of specifiers) {
		const resolved = verifyResolution(ts, options, directory, path, extension, specifier);
		assert.ok(resolved.startsWith(`${resolve(directory, "node_modules", "@formbar")}/`));
	}
	for (const specifier of peerSpecifiers) {
		const importer = specifier === "@arbitre/core" ? "arbiter" : "expressions";
		const declaration = resolve(
			directory,
			"node_modules",
			"@formbar",
			importer,
			"dist",
			`index.d.${extension === "cts" ? "cts" : "ts"}`,
		);
		verifyResolution(ts, options, directory, declaration, extension, specifier);
	}
	console.log(
		`CONSUMER_TYPES react=${directory.split("/").at(-1)} fixture=${fixture} resolved=${specifiers.length} peers=${peerSpecifiers.length} diagnostics=0`,
	);
}

function runtime(directory) {
	for (const specifier of specifiers) {
		const esm = execFileSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`import * as entry from ${JSON.stringify(specifier)}; console.log(JSON.stringify(Object.keys(entry).sort()))`,
			],
			{ cwd: directory, encoding: "utf8" },
		).trim();
		const cjs = execFileSync(
			process.execPath,
			["-e", `console.log(JSON.stringify(Object.keys(require(${JSON.stringify(specifier)})).sort()))`],
			{ cwd: directory, encoding: "utf8" },
		).trim();
		assert.deepEqual(JSON.parse(esm), JSON.parse(cjs), `${specifier}: runtime export parity`);
	}
	console.log(`CONSUMER_RUNTIME react=${directory.split("/").at(-1)} parity=${specifiers.length}`);
}

try {
	const tarballs = installTarballs();
	for (const major of [18, 19]) {
		const directory = resolve(temporary, `react-${major}`);
		mkdirSync(directory);
		writeFileSync(resolve(directory, "package.json"), JSON.stringify({ private: true, type: "module" }));
		const react = major === 18 ? "18.3.1" : "19.2.0";
		const types = major === 18 ? "18.3.27" : "19.2.14";
		const domTypes = major === 18 ? "18.3.7" : "19.2.3";
		npm(
			[
				"install",
				"--ignore-scripts",
				"--no-package-lock",
				"--no-save",
				"--install-strategy=nested",
				...tarballs,
				`react@${react}`,
				`react-dom@${react}`,
				`@types/react@${types}`,
				`@types/react-dom@${domTypes}`,
				"@types/node@22.15.30",
				"typescript@5.7.3",
			],
			directory,
		);
		verifyInstalledPacks(directory);
		for (const [fixture, moduleKind, resolution, extension] of [
			["esm.mts", "NodeNext", "NodeNext", "mts"],
			["cjs.cts", "NodeNext", "NodeNext", "cts"],
			["require.cts", "NodeNext", "NodeNext", "cts"],
			["bundler.mts", "ESNext", "Bundler", "mts"],
		])
			compile(directory, fixture, moduleKind, resolution, extension);
		compile(directory, "upstream.cts", "NodeNext", "NodeNext", "cts");
		runtime(directory);
	}
	console.log(`CONSUMER_PACK source=${root} native_tarballs=${tarballs.length} temporary=${temporary}`);
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
