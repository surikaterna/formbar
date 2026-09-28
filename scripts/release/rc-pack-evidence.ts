/** #371: read-only local npm pack observation; never evidence of future publish bytes. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type PackageAudit, auditPackages } from "../package-artifacts/audit";
import { type SourceWitness, sourceCheck } from "./rc-registry-proof";
import { checkChangelog, rcPackages, rcVersion } from "./rc-reviewed-plan";

const names = rcPackages;
const version = rcVersion;
const command = "npm pack --dry-run --json; npm pack --pack-destination <isolated temp> --json";
const lifecycle = "npm pack defaults (prepack, prepare, postpack if configured); no package defines these scripts";

function run(program: string, args: string[], cwd: string): string {
	return execFileSync(program, args, { cwd, encoding: "utf8", maxBuffer: 1024 * 1024 }).trim();
}
function json(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}
export function checkSnapshot(root: string, sha: string, tree: string): void {
	if (
		!/^[0-9a-f]{40}$/.test(sha) ||
		!/^[0-9a-f]{40}$/.test(tree) ||
		run("git", ["rev-parse", "HEAD"], root) !== sha ||
		run("git", ["rev-parse", "HEAD^{tree}"], root) !== tree ||
		run("git", ["status", "--porcelain"], root) !== ""
	)
		throw new Error("dirty or drifting audited checkout");
	const current = JSON.parse(run("gh", ["api", "repos/surikaterna/formbar/pulls/298"], root));
	const commit = JSON.parse(run("gh", ["api", `repos/surikaterna/formbar/git/commits/${sha}`], root));
	if (current.head?.sha !== sha || !/^[0-9a-f]{40}$/.test(current.base?.sha) || commit.tree?.sha !== tree)
		throw new Error("version PR head/base/tree drift");
}

export function loadRcSource(root: string, sha: string, tree: string): SourceWitness {
	const manifests: Record<string, unknown> = {};
	const changelogs: Record<string, string> = {};
	for (const name of names) {
		const directory = resolve(root, "packages", name);
		const manifest = json(resolve(directory, "package.json")) as { scripts?: Record<string, string> };
		if (["prepack", "prepare", "postpack", "publish", "prepublishOnly"].some((key) => manifest.scripts?.[key]))
			throw new Error("unexpected npm pack lifecycle script");
		manifests[name] = manifest;
		changelogs[name] = readFileSync(resolve(directory, "CHANGELOG.md"), "utf8");
		checkChangelog(name, changelogs[name]);
	}
	const pre = json(resolve(root, ".changeset/pre.json")) as { initialVersions: Record<string, string> };
	const source: SourceWitness = {
		commit: sha,
		tree,
		pre,
		manifests,
		changelogs,
		artifacts: Object.fromEntries(names.map((name) => [name, undefined])),
		initialLatest: Object.fromEntries(names.map((name) => [name, pre.initialVersions[`@formbar/${name}`]])),
	};
	sourceCheck(source);
	return source;
}

function packDigests(left: PackageAudit[], right: PackageAudit[]) {
	const outputs = [];
	for (const name of names) {
		const packageName = `@formbar/${name}`;
		const a = left.find((pack) => pack.name === packageName);
		const b = right.find((pack) => pack.name === packageName);
		if (!a || !b || !a.bytes.equals(b.bytes)) throw new Error("npm pack bytes not reproducible");
		outputs.push({
			name: packageName,
			version,
			integrity: `sha512-${createHash("sha512").update(a.bytes).digest("base64")}`,
			shasum: createHash("sha1").update(a.bytes).digest("hex"),
			size: a.bytes.length,
		});
	}
	return outputs;
}

export function observeLocalPacks(
	root: string,
	sha: string,
	tree: string,
	capture?: (bytes: readonly PackageAudit[]) => void,
) {
	if (run("node", ["--version"], root) !== "v22.23.2" || run("npm", ["--version"], root) !== "11.20.0")
		throw new Error("Node/npm versions not pinned");
	checkSnapshot(root, sha, tree);
	loadRcSource(root, sha, tree);
	const previous = { ...process.env };
	try {
		for (const key of ["NPM_TOKEN", "NODE_AUTH_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"]) delete process.env[key];
		process.env.npm_config_userconfig = "/dev/null";
		process.env.npm_config_offline = "true";
		const first = auditPackages(root);
		checkSnapshot(root, sha, tree);
		const second = auditPackages(root);
		checkSnapshot(root, sha, tree);
		const packs = packDigests(first, second);
		capture?.(first);
		return {
			commit: sha,
			tree,
			node: "v22.23.2",
			npm: "11.20.0",
			command,
			lifecycle,
			decision: "UNVERIFIABLE" as const,
			reason: "separate npm pack cannot prove future changeset publish upload bytes or publisher permission",
			packs,
		};
	} finally {
		process.env = previous;
	}
}
