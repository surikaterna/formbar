// Child-only transport doubles. The adapter, authority, plan digest and filesystem fence are real.
const fs = require("node:fs");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const sha = "a".repeat(40);
const tree = "b".repeat(40);
const bytes = Buffer.from("fake offline npm pack bytes");
const sha512 = crypto.createHash("sha512").update(bytes).digest("hex");
const shasum = crypto.createHash("sha1").update(bytes).digest("hex");
const names = ["expressions", "core", "declarative", "from-schema", "react", "arbiter", "react-schema"];
const candidates = names.map((name) =>
	Object.freeze({
		name: `@formbar/${name}`,
		version: "0.23.0-rc.0",
		sha512,
		shasum,
		integrity: `sha512-${Buffer.from(sha512, "hex").toString("base64")}`,
	}),
);
require.extensions[".ts"] = (module, filename) =>
	module._compile(
		ts.transpileModule(fs.readFileSync(filename, "utf8"), {
			compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
		}).outputText,
		filename,
	);
const original = Module._load;
const source = {
	loadRcSource: () => ({
		pre: { mode: "pre", tag: "rc" },
		manifests: Object.fromEntries(names.map((name) => [name, { name: `@formbar/${name}`, version: "0.23.0-rc.0" }])),
		changelogs: Object.fromEntries(names.map((name) => [name, "fake audited source"])),
		initialLatest: Object.fromEntries(names.map((name) => [name, "0.22.0"])),
	}),
};
function fakeGo(_, run) {
	if (
		process.env.FAKE_GO !== "true" ||
		run.runId !== Number(process.env.GITHUB_RUN_ID) ||
		run.attempt !== 1 ||
		run.checkoutSha !== sha ||
		run.checkoutTree !== tree ||
		run.expectedSha !== sha ||
		run.eventSha !== sha ||
		run.repository !== "surikaterna/formbar"
	)
		throw Error("fake #365 GO denied");
}
function fakeModule(request) {
	if (request === "./rc-pack-evidence" || request === "./rc-source-local") return source;
	if (request === "./github-read")
		return {
			createGitHubRead: () => ({
				get: async () => {
					throw Error("unexpected GH request");
				},
			}),
		};
	if (request === "./live-evidence") return { fetchRcEvidence: fakeGo };
	if (request === "./rc-prepacked-candidates" || request === "./rc-prepacked-candidates.js")
		return { prepackProtectedRun: async () => candidates, verifiedCandidateBytes: async () => Buffer.from(bytes) };
	if (request === "./rc-live-reads")
		return {
			createRegistryGitHubReader: () => ({}),
			inspectLiveRc: async () => ({
				packages: candidates.map((candidate) => ({
					name: candidate.name,
					observation: "PUBLIC_ABSENT_OBSERVED",
					local: { integrity: candidate.integrity, shasum: candidate.shasum },
				})),
			}),
		};
	if (request === "./rc-protected-providers")
		return {
			signedPublished: async () => {
				throw Error("unexpected signed existing");
			},
			publishProtected: async (name) => {
				fs.appendFileSync(process.env.PUT_LOG, `${process.env.GITHUB_RUN_ID} ${name}\n`);
				throw Error("uncertain first PUT");
			},
		};
}
Module._load = function (request, parent, main) {
	if (request === "node:child_process")
		return {
			...cp,
			execFileSync(command, args, options) {
				if (command === "git" && options?.cwd === process.cwd()) {
					if (args[0] === "status") return "";
					if (args[0] === "rev-parse") return args[1] === "HEAD^{tree}" ? tree : sha;
				}
				return cp.execFileSync(command, args, options);
			},
		};
	if (parent?.filename.startsWith(root + path.sep)) {
		const fake = fakeModule(request);
		if (fake) return fake;
	}
	return original.call(this, request, parent, main);
};
require(path.join(root, "rc-protected.ts"))
	.runProtectedRc()
	.then(
		(result) => {
			process.stdout.write(JSON.stringify(result));
		},
		(error) => {
			process.stdout.write(JSON.stringify({ status: "STOPPED", reason: error.message }));
			process.exitCode = 1;
		},
	);
