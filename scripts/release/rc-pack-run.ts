/** CLI for disposable read-only RC pack observation; output contains digests, never credentials. */
import { resolve } from "node:path";
import { observeLocalPacks } from "./rc-pack-evidence";

const [root, sha, tree] = process.argv.slice(2);
if (!root || !sha || !tree) throw new Error("expected checkout, commit and tree");
console.log(JSON.stringify(observeLocalPacks(resolve(root), sha, tree)));
