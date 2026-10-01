/** Read-only, dependency-free local RC source checks shared by both release gates. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type SourceWitness, sourceCheck } from "./rc-registry-proof";
import { checkChangelog, rcPackages } from "./rc-reviewed-plan";

function json(path: string): unknown {
	return JSON.parse(readFileSync(path, "utf8"));
}

export function loadRcSource(root: string, sha: string, tree: string): SourceWitness {
	const manifests: Record<string, unknown> = {};
	const changelogs: Record<string, string> = {};
	for (const name of rcPackages) {
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
		artifacts: Object.fromEntries(rcPackages.map((name) => [name, undefined])),
		initialLatest: Object.fromEntries(rcPackages.map((name) => [name, pre.initialVersions[`@formbar/${name}`]])),
	};
	sourceCheck(source);
	return source;
}
