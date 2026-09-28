/** #382 disabled empirical CLI study. Never imported by a workflow or release entrypoint. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const names = ["expressions", "core", "declarative", "from-schema", "react", "arbiter", "react-schema"];
const version = "0.23.0-rc.0";
const sha = (bytes, algorithm) => createHash(algorithm).update(bytes).digest("hex");
const run = (command, args, cwd, env = process.env) =>
	execFileSync(command, args, { cwd, env, encoding: "utf8" }).trim();
const body = async (req) => {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	return Buffer.concat(chunks);
};
const reply = (res, code, value) => {
	res.writeHead(code, { "content-type": "application/json" });
	res.end(JSON.stringify(value));
};

function preflight(root, commit, tree, base) {
	assert.match(commit, /^[a-f0-9]{40}$/);
	assert.match(tree, /^[a-f0-9]{40}$/);
	assert.equal(run("git", ["rev-parse", "HEAD"], root), commit);
	assert.equal(run("git", ["rev-parse", "HEAD^{tree}"], root), tree);
	assert.equal(run("git", ["status", "--porcelain"], root), "");
	assert.equal(run("node", ["--version"], root), "v22.23.2");
	assert.equal(run("npm", ["--version"], root), "11.20.0");
	const pr = JSON.parse(run("gh", ["pr", "view", "298", "--json", "headRefOid,baseRefOid,state"], root));
	assert.deepEqual(pr, { headRefOid: commit, baseRefOid: base, state: "OPEN" });
	checkPlan(root);
}

function checkPlan(root) {
	const pre = JSON.parse(readFileSync(join(root, ".changeset/pre.json")));
	assert.equal(pre.mode, "pre");
	assert.equal(pre.tag, "rc");
	assert.deepEqual(pre.changesets, [
		"bound-noop-witness",
		"certified-object-descendants",
		"checked-bound-handler",
		"final-owned-generation",
		"final-retained-attempt-gate",
		"original-bound-attempt-receipt",
		"owned-disposal-settlement",
		"owned-scheduling-boundary",
		"owned-semantic-epoch",
		"public-bound-omission",
		"react-omission-attempt-ui",
		"real-bound-guarded-bridge",
		"real-bound-omission-supplier",
		"reference-codec",
		"scoped-async-core",
		"scoped-async-declarative",
		"scoped-async-from-schema",
		"scoped-async-react-schema",
		"scoped-final-async",
		"scoped-ownership-receipt",
		"scoped-validation-public-types",
		"unified-issue-ownership",
		"validated-hidden-submission-policy",
	]);
	for (const name of names) checkPackage(root, name);
}

function checkPackage(root, name) {
	const pkg = JSON.parse(readFileSync(join(root, "packages", name, "package.json")));
	assert.equal(pkg.name, `@formbar/${name}`);
	assert.equal(pkg.version, version);
	assert.equal(pkg.private, undefined);
	assert.equal(pkg.publishConfig, undefined);
	assert.deepEqual(
		Object.entries(pkg.dependencies ?? {})
			.filter(([key]) => key.startsWith("@formbar/"))
			.sort(),
		{
			expressions: [],
			core: ["expressions"],
			declarative: ["core", "expressions"],
			"from-schema": ["core", "declarative", "expressions"],
			react: ["core", "expressions"],
			arbiter: ["core", "expressions"],
			"react-schema": ["core", "declarative", "from-schema", "react"],
		}[name]
			.map((edge) => [`@formbar/${edge}`, `^${version}`])
			.sort(),
	);
	assert.equal(
		Object.keys(pkg.peerDependencies ?? {}).some((key) => key.startsWith("@formbar/")),
		false,
	);
	for (const event of ["prepack", "prepare", "postpack", "prepublishOnly", "publish", "postpublish"])
		assert.equal(pkg.scripts?.[event], undefined);
}

function packs(root, temp, commit, tree, base) {
	const result = [];
	for (const name of names) {
		const cwd = join(root, "packages", name);
		const pair = [];
		for (const side of ["a", "b"]) {
			const dir = join(temp, `${name}-${side}`);
			mkdirSync(dir);
			const output = JSON.parse(
				run("npm", ["pack", "--pack-destination", dir, "--json"], cwd, {
					...process.env,
					npm_config_userconfig: "/dev/null",
					npm_config_offline: "true",
				}),
			);
			assert.equal(output.length, 1);
			assert.equal(output[0].name, `@formbar/${name}`);
			assert.equal(output[0].version, version);
			assert.equal(readdirSync(dir).length, 1);
			pair.push({ bytes: readFileSync(join(dir, output[0].filename)), path: join(dir, output[0].filename) });
		}
		assert.deepEqual(pair[0].bytes, pair[1].bytes, `${name} nondeterministic pack`);
		for (const algorithm of ["sha512", "sha1"])
			assert.equal(sha(pair[0].bytes, algorithm), sha(pair[1].bytes, algorithm), `${name} ${algorithm} drift`);
		preflight(root, commit, tree, base);
		result.push({ name: `@formbar/${name}`, ...pair[0] });
	}
	return result;
}

function fakeRegistry() {
	const uploads = [];
	const exchanges = [];
	const server = http.createServer(async (req, res) => {
		try {
			const url = new URL(req.url, "http://127.0.0.1");
			if (url.pathname === "/oidc") return reply(res, 200, { value: "fake.oidc.token" });
			if (url.pathname.startsWith("/-/npm/v1/oidc/token/exchange/package/")) {
				assert.equal(req.method, "POST");
				assert.equal(req.headers.authorization, "Bearer fake.oidc.token");
				exchanges.push(url.pathname);
				return reply(res, 200, { token: "FAKE-NOT-A-CREDENTIAL" });
			}
			if (req.method === "GET") {
				if (url.pathname.endsWith(".tgz")) {
					const target = uploads.find(
						({ value }) => new URL(value.versions[version].dist.tarball).pathname === url.pathname,
					);
					if (!target) return reply(res, 404, { error: "not found" });
					const tar = Buffer.from(target.value._attachments[`${target.value.name}-${version}.tgz`].data, "base64");
					res.writeHead(200, { "content-type": "application/octet-stream" });
					return res.end(tar);
				}
				const entry = uploads.find(({ path }) => url.pathname === path || url.pathname.startsWith(`${path}/`));
				if (!entry) return reply(res, 404, { error: "not found" });
				const { value, path } = entry;
				const meta = value.versions[version];
				if (url.pathname === `${path}/${version}`) return reply(res, 200, meta);
				if (url.pathname === path)
					return reply(res, 200, {
						name: value.name,
						versions: { [version]: meta },
						"dist-tags": { latest: "0.22.0", rc: version },
					});
				return reply(res, 404, { error: "not found" });
			}
			if (req.method !== "PUT" || !url.pathname.startsWith("/@formbar%2f")) return reply(res, 403, { error: "denied" });
			assert.equal(req.headers.authorization, "Bearer FAKE-NOT-A-CREDENTIAL");
			const raw = await body(req);
			assert.ok(raw.length < 20_000_000);
			const value = JSON.parse(raw.toString("utf8"));
			uploads.push({ path: url.pathname, value });
			return reply(res, 201, { ok: true });
		} catch {
			return reply(res, 403, { error: "invalid fixture request" });
		}
	});
	return { server, uploads, exchanges };
}

async function cli(candidate, root, temp, url) {
	const preload = fileURLToPath(new URL("./rc-fake-boundary.cjs", import.meta.url));
	const args = [
		"publish",
		candidate.path,
		"--tag",
		"rc",
		"--access",
		"public",
		"--provenance",
		"--registry",
		url,
		"--ignore-scripts=false",
		"--fetch-retries=0",
		"--loglevel=verbose",
	];
	const env = {
		PATH: process.env.PATH,
		HOME: temp,
		TMPDIR: temp,
		NODE_OPTIONS: `--require=${preload}`,
		npm_config_userconfig: "/dev/null",
		npm_config_cache: join(temp, "cache"),
		NO_PROXY: "127.0.0.1",
		no_proxy: "127.0.0.1",
		GITHUB_ACTIONS: "true",
		CI: "true",
		GITHUB_REPOSITORY: "surikaterna/formbar",
		GITHUB_REF: "refs/heads/main",
		GITHUB_SHA: process.env.FAKE_COMMIT,
		GITHUB_WORKFLOW_REF: "surikaterna/formbar/.github/workflows/release.yml@refs/heads/main",
		GITHUB_RUN_ID: "12345",
		GITHUB_RUN_ATTEMPT: "1",
		ACTIONS_ID_TOKEN_REQUEST_URL: `${url}oidc`,
		ACTIONS_ID_TOKEN_REQUEST_TOKEN: "FAKE",
	};
	const child = spawn("npm", args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
	const stderr = [];
	child.stderr.on("data", (chunk) => stderr.push(chunk));
	child.stdout.resume();
	const exit = await new Promise((resolveExit) => child.on("close", resolveExit));
	assert.equal(exit, 0, `${candidate.name}: ${Buffer.concat(stderr).toString().slice(-4000)}`);
	return args;
}

async function inspectUpload(candidate, upload, path, url, args) {
	assert.equal(upload.name, candidate.name);
	assert.equal(upload.access, "public");
	assert.deepEqual(upload["dist-tags"], { rc: version });
	const meta = upload.versions[version];
	assert.equal(meta.gitHead, undefined, "tarball gitHead observed absent");
	const attachment = upload._attachments[`${candidate.name}-${version}.tgz`];
	const bytes = Buffer.from(attachment.data, "base64");
	assert.deepEqual(bytes, candidate.bytes, "CLI repacked or mutated tarball");
	assert.equal(attachment.length, bytes.length);
	assert.equal(meta.dist.integrity, `sha512-${createHash("sha512").update(bytes).digest("base64")}`);
	assert.equal(meta.dist.shasum, sha(bytes, "sha1"));
	const packument = await (await fetch(`${url.slice(0, -1)}${path}`)).json();
	const exact = await (await fetch(`${url.slice(0, -1)}${path}/${version}`)).json();
	const downloaded = Buffer.from(await (await fetch(meta.dist.tarball)).arrayBuffer());
	assert.equal(packument["dist-tags"].latest, "0.22.0");
	assert.equal(packument["dist-tags"].rc, version);
	assert.deepEqual(exact.dist, meta.dist);
	assert.deepEqual(downloaded, candidate.bytes);
	const bundle = JSON.parse(upload._attachments[`${candidate.name}-${version}.sigstore`].data);
	const statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, "base64").toString());
	assert.equal(statement.predicateType, "https://slsa.dev/provenance/v1");
	assert.deepEqual(statement.subject, [
		{ name: `pkg:npm/${candidate.name.replace("@", "%40")}@${version}`, digest: { sha512: sha(bytes, "sha512") } },
	]);
	return {
		name: candidate.name,
		args: args.slice(0, 7),
		sha512: sha(bytes, "sha512"),
		sha1: sha(bytes, "sha1"),
		bytes: bytes.length,
		gitHead: "absent",
		signer: "FAKE",
	};
}

async function main() {
	const [rootArg, commit, tree, base] = process.argv.slice(2);
	const root = resolve(rootArg);
	const temp = mkdtempSync(join(tmpdir(), "382-fake-npm-"));
	const { server, uploads, exchanges } = fakeRegistry();
	try {
		preflight(root, commit, tree, base);
		const candidates = packs(root, temp, commit, tree, base);
		server.listen(0, "127.0.0.1");
		await new Promise((ready) => server.once("listening", ready));
		const url = `http://127.0.0.1:${server.address().port}/`;
		process.env.FAKE_COMMIT = commit;
		const trace = [];
		for (const candidate of candidates) {
			preflight(root, commit, tree, base);
			assert.deepEqual(readFileSync(candidate.path), candidate.bytes, "changed after preflight");
			const args = await cli(candidate, root, temp, url);
			assert.equal(uploads.length, trace.length + 1, "missing or extra PUT");
			assert.equal(exchanges.length, uploads.length, "fake OIDC exchange missing");
			trace.push(await inspectUpload(candidate, uploads.at(-1).value, uploads.at(-1).path, url, args));
		}
		preflight(root, commit, tree, base);
		console.log(
			JSON.stringify(
				{
					commit,
					tree,
					base,
					node: process.version,
					npm: run("npm", ["--version"], root),
					verdict: "UNVERIFIABLE",
					reason: "fake OIDC and unsigned signer cannot satisfy #374",
					trace,
				},
				null,
				2,
			),
		);
	} finally {
		await new Promise((done) => server.close(done));
		rmSync(temp, { recursive: true, force: true });
	}
}

await main();
