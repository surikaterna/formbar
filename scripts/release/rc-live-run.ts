/** #371: public GET-only CLI; never supplies a registry credential or grants release authority. */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { PackageAudit } from "../package-artifacts/audit";
import { createRegistryGitHubReader, inspectLiveRc } from "./rc-live-reads";
import { checkSnapshot, loadRcSource, observeLocalPacks } from "./rc-pack-evidence";

async function main(root: string, sha: string, tree: string) {
	let bytes: readonly PackageAudit[] = [];
	const local = observeLocalPacks(root, sha, tree, (packed) => {
		bytes = packed;
	});
	const source = loadRcSource(root, sha, tree);
	checkSnapshot(root, sha, tree);
	const pack = {
		async pack(name: string) {
			const entry = bytes.find((item) => item.name === `@formbar/${name}`);
			const proof = local.packs.find((item) => item.name === `@formbar/${name}`);
			if (!entry || !proof || proof.shasum !== createHash("sha1").update(entry.bytes).digest("hex"))
				throw new Error("local pack drift");
			return entry.bytes;
		},
	};
	const plan = await inspectLiveRc(createRegistryGitHubReader("", ""), pack, source);
	checkSnapshot(root, sha, tree);
	return { commit: sha, tree, pack: local, ...plan };
}

const [root, sha, tree] = process.argv.slice(2);
if (!root || !sha || !tree) throw new Error("expected checkout, commit and tree");
main(resolve(root), sha, tree)
	.then((plan) => console.log(JSON.stringify(plan)))
	.catch(() => {
		console.error("RC public read failed; no release authority");
		process.exitCode = 1;
	});
