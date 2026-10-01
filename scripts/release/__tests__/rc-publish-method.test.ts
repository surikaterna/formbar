import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
	type PublishContext,
	type PublishMethod,
	type RegistrySnapshot,
	loadRcManifests,
	provePublishMethod,
	rcPackages,
} from "../rc-publish-method";
import { consumed, initialVersions, rcEdges } from "../rc-reviewed-plan";

const roots: string[] = [];
const commit = "a".repeat(40);
const version = "0.23.0-rc.0";
const context: PublishContext = {
	commit,
	node: "22.23.2",
	npm: "11.20.0",
	oidc: true,
	approved: true,
	credentials: {},
};
const name = (directory: string) => `@formbar/${directory}`;
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "formbar-378-"));
	roots.push(root);
	await mkdir(join(root, ".changeset"));
	await mkdir(join(root, "packages"));
	await writeFile(
		join(root, ".changeset/pre.json"),
		JSON.stringify({
			mode: "pre",
			tag: "rc",
			changesets: consumed,
			initialVersions,
		}),
	);
	for (const directory of rcPackages) {
		await mkdir(join(root, "packages", directory));
		await writeFile(
			join(root, "packages", directory, "package.json"),
			JSON.stringify({
				name: name(directory),
				version,
				dependencies: {
					...Object.fromEntries(rcEdges[directory].map((edge) => [name(edge), `^${version}`])),
				},
			}),
		);
		await writeFile(
			join(root, "packages", directory, "CHANGELOG.md"),
			`# ${name(directory)}\n\n## ${version}\n\nNotes`,
		);
	}
	return root;
}

function fake(existing: string[] = []) {
	const snapshots = new Map<string, RegistrySnapshot>(
		rcPackages.map((dir) => [
			name(dir),
			{
				name: name(dir),
				latest: "0.22.0",
				...(existing.includes(dir) ? { rc: version } : {}),
				versions: {
					"0.22.0": { gitHead: "b".repeat(40) },
					...(existing.includes(dir) ? { [version]: { gitHead: commit } } : {}),
				},
			},
		]),
	);
	const calls: string[][] = [];
	const reads: string[] = [];
	const method: PublishMethod = {
		async read(pkg) {
			reads.push(pkg);
			const snapshot = snapshots.get(pkg);
			if (!snapshot) throw new Error("missing fixture snapshot");
			return structuredClone(snapshot);
		},
	};
	return { snapshots, calls, reads, method };
}

test.each([[[]], [[...rcPackages]], [["core", "react"]]])(
	"fresh, existing and mixed registries cannot turn caller claims into signed verification: %j",
	async (existing) => {
		const { calls, reads, method } = fake(existing);
		// A forged verify property cannot authorize a skip, even with the right SHA and rc tag.
		Object.assign(method, {
			verify: async () => true,
			run: async () => {
				throw new Error("unsafe write");
			},
		});
		await expect(provePublishMethod(await fixture(), context, method)).rejects.toThrow(
			"SIGNED_VERIFICATION_UNAVAILABLE",
		);
		expect(reads).toEqual(rcPackages.map(name));
		expect(calls).toEqual([]);
	},
);

test.each([undefined, "0.22.0-rc.1"])("same SHA but rc dist-tag %s stops before skip", async (tag) => {
	const { snapshots, method } = fake(["core"]);
	const core = snapshots.get(name("core"));
	if (!core) throw new Error("missing fixture core");
	Object.assign(core, { rc: tag });
	await expect(provePublishMethod(await fixture(), context, method)).rejects.toThrow("missing or wrong rc dist-tag");
});

test("missing gitHead waits for independent signed proof, not metadata classification", async () => {
	const { snapshots, method } = fake(["core"]);
	const snapshot = snapshots.get(name("core"));
	if (!snapshot?.versions[version]) throw new Error("missing fixture version");
	snapshot.versions[version] = {};
	await expect(provePublishMethod(await fixture(), context, method)).rejects.toThrow("SIGNED_VERIFICATION_UNAVAILABLE");
});

test.each([
	"missing OIDC",
	"bearer",
	"wrong npm",
	"absent latest",
	"wrong pre",
	"wrong range",
	"foreign SHA",
	"failed read",
])("prewrite stop: %s", async (scenario) => {
	const root = await fixture();
	const { calls, snapshots, method } = fake(scenario === "foreign SHA" ? ["core"] : []);
	const modified = structuredClone(context);
	if (scenario === "missing OIDC") modified.oidc = false;
	if (scenario === "bearer") modified.credentials.token = "forbidden";
	if (scenario === "wrong npm") modified.npm = "11.19.0";
	const core = snapshots.get(name("core"));
	if (!core) throw new Error("missing fixture core");
	if (scenario === "absent latest") core.latest = "";
	if (scenario === "foreign SHA") {
		const published = core.versions[version];
		if (!published) throw new Error("missing fixture version");
		published.gitHead = "c".repeat(40);
	}
	if (scenario === "failed read")
		method.read = async () => {
			throw new Error("read unavailable");
		};
	if (scenario === "wrong pre") await writeFile(join(root, ".changeset/pre.json"), "{}");
	if (scenario === "wrong range") {
		const path = join(root, "packages/declarative/package.json");
		const manifest = JSON.parse(await readFile(path, "utf8"));
		manifest.dependencies[name("core")] = "^0.22.0";
		await writeFile(path, JSON.stringify(manifest));
	}
	await expect(provePublishMethod(root, modified, method)).rejects.toThrow();
	expect(calls).toEqual([]);
});

test("reverse core to react edge is forbidden even at the correct range", async () => {
	const root = await fixture();
	const path = join(root, "packages/core/package.json");
	const manifest = JSON.parse(await readFile(path, "utf8"));
	manifest.dependencies[name("react")] = `^${version}`;
	await writeFile(path, JSON.stringify(manifest));
	await expect(loadRcManifests(root)).rejects.toThrow("invalid RC dependency graph");
});

test("missing prerelease expressions edge is rejected", async () => {
	const root = await fixture();
	const path = join(root, "packages/core/package.json");
	const manifest = JSON.parse(await readFile(path, "utf8"));
	delete manifest.dependencies[name("expressions")];
	await writeFile(path, JSON.stringify(manifest));
	await expect(loadRcManifests(root)).rejects.toThrow("invalid RC dependency graph");
});

test("manifest validation rejects absent pre state and unsupported publish config", async () => {
	const root = await fixture();
	const path = join(root, "packages/core/package.json");
	const manifest = JSON.parse(await readFile(path, "utf8"));
	manifest.publishConfig = { tag: "latest" };
	await writeFile(path, JSON.stringify(manifest));
	await expect(loadRcManifests(root)).rejects.toThrow();
});

async function cliFixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "formbar-378-cli-"));
	roots.push(root);
	await mkdir(join(root, "bin"));
	await mkdir(join(root, "home"));
	await mkdir(join(root, ".changeset"));
	await mkdir(join(root, "packages"));
	await mkdir(join(root, "packages/probe"));
	await writeFile(join(root, "package.json"), JSON.stringify({ private: true, workspaces: ["packages/*"] }));
	await writeFile(
		join(root, "packages/probe/package.json"),
		JSON.stringify({ name: "@formbar/probe", version, publishConfig: { access: "public" } }),
	);
	await writeFile(
		join(root, ".changeset/config.json"),
		JSON.stringify({
			$schema: "https://unpkg.com/@changesets/config@2.3.1/schema.json",
			changelog: "@changesets/changelog-git",
			commit: false,
			fixed: [],
			linked: [],
			access: "public",
			baseBranch: "main",
			updateInternalDependencies: "patch",
			ignore: [],
		}),
	);
	await writeFile(
		join(root, ".changeset/pre.json"),
		JSON.stringify({ mode: "pre", tag: "rc", initialVersions: { "@formbar/probe": "0.22.0" }, changesets: [] }),
	);
	const fakeNpm = join(root, "bin/npm");
	await writeFile(
		fakeNpm,
		`#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(args)+'\\n');
if (args[0] === 'info') process.stdout.write(JSON.stringify({name:'@formbar/probe',versions:JSON.parse(process.env.FAKE_VERSIONS)}));
else if (args[0] === 'publish') process.stdout.write('{}');
else process.exit(9);
`,
		{ mode: 0o700 },
	);
	return root;
}

function invokeCli(root: string, log: string, versions: readonly string[], customTag = false) {
	const cli = resolve("node_modules/@changesets/cli/bin.js");
	return spawnSync(process.execPath, [cli, "publish", ...(customTag ? ["--tag", "rc"] : []), "--no-git-tag"], {
		cwd: root,
		encoding: "utf8",
		timeout: 15000,
		env: {
			PATH: `${join(root, "bin")}${delimiter}${process.env.PATH}`,
			HOME: join(root, "home"),
			FAKE_LOG: log,
			FAKE_VERSIONS: JSON.stringify(versions),
			npm_config_tag: "rc",
			npm_config_userconfig: join(root, "home", "missing-npmrc"),
		},
	});
}

test("installed Changesets 2.31.0 is safely confined to scratch and fake npm", async () => {
	const root = await cliFixture();
	const installed = JSON.parse(await readFile(resolve("node_modules/@changesets/cli/package.json"), "utf8"));
	expect(installed.version).toBe("2.31.0");
	const log = join(root, "calls");
	for (const [history, versions, expectedTag, count] of [
		["stable", ["0.22.0"], "rc", 1],
		["only-pre", ["0.22.0-rc.1"], "latest", 1],
		["existing", [version], "", 0],
	] as const) {
		await writeFile(log, "");
		const result = invokeCli(root, log, versions);
		const calls = (await readFile(log, "utf8"))
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as string[]);
		expect(result.status, `${history}: ${result.stderr} ${result.stdout}`).toBe(0);
		expect(calls.filter((args) => args[0] === "publish")).toHaveLength(count);
		if (count) {
			const publish = calls.find((args) => args[0] === "publish");
			if (!publish) throw new Error("missing fake publish");
			expect(publish[publish.indexOf("--tag") + 1]).toBe(expectedTag);
		}
	}
	await writeFile(log, "");
	const rejected = invokeCli(root, log, [], true);
	expect(rejected.status).not.toBe(0);
	expect(rejected.stderr + rejected.stdout).toContain("Releasing under custom tag is not allowed in pre mode");
	expect(await readFile(log, "utf8")).toBe("");
});
