// Test-only: return unsigned payload bytes, never a Sigstore bundle or signature.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const Module = require("node:module");
const { join } = require("node:path");

assert.equal(process.version, "v22.23.2");
const root = process.argv[2];
assert.equal(JSON.parse(readFileSync(join(root, "package.json"))).version, "11.20.0");
assert.equal(JSON.parse(readFileSync(join(root, "node_modules/libnpmpublish/package.json"))).version, "11.2.1");
const generator = join(root, "node_modules/libnpmpublish/lib/provenance.js");
assert.equal(
	createHash("sha256").update(readFileSync(generator)).digest("hex"),
	"ee9b1bc8e3f636fbaf5138a3e183ce3c6d42bb5dd57ab004578e534dd08da46b",
);
for (const key of Object.keys(process.env)) assert.doesNotMatch(key, /TOKEN|AUTH|SECRET|OIDC/i);
const counters = { network: 0, oidc: 0, signing: 0, put: 0, attestStub: 0 };
const forbidden = () => {
	counters.network++;
	throw new Error("offline fixture forbids network/OIDC/signing");
};
globalThis.fetch = forbidden;
for (const [name, methods] of [
	["node:http", ["request", "get"]],
	["node:https", ["request", "get"]],
	["node:net", ["connect", "createConnection"]],
	["node:tls", ["connect"]],
]) {
	const api = require(name);
	for (const method of methods) api[method] = forbidden;
}
const payloads = [];
const load = Module._load;
Module._load = function (name, parent, main) {
	if (name === "sigstore")
		return {
			attest: async (bytes, type) => {
				assert.equal(type, "application/vnd.in-toto+json");
				counters.attestStub++;
				payloads.push(bytes.toString("base64"));
				return bytes;
			},
			verify: forbidden,
			sign: forbidden,
		};
	if (name === "ci-info") return Object.freeze({ GITHUB_ACTIONS: true, GITLAB: false });
	if (name !== generator && name !== "node:fs/promises") return forbidden();
	return load.call(this, name, parent, main);
};

async function exercise() {
	const { generateProvenance } = require(generator);
	const subject = [{ name: "pkg:npm/%40formbar/expressions@0.23.0-rc.0", digest: { sha512: "a".repeat(128) } }];
	await generateProvenance(subject, {});
	for (const name of ["GITHUB_EVENT_NAME", "GITHUB_REPOSITORY_ID", "GITHUB_REPOSITORY_OWNER_ID"])
		delete process.env[name];
	await generateProvenance(subject, {});
	assert.equal(counters.attestStub, 2);
	process.stdout.write(JSON.stringify({ payloads, counters }));
}
exercise().catch(() => {
	process.exitCode = 1;
});
