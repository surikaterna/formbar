/** #383: immutable RC content contract; PR identity requires fresh owner review on each refresh. */
import { createHash } from "node:crypto";

export const rcVersion = "0.23.0-rc.0";
export const rcPackages = [
	"expressions",
	"core",
	"declarative",
	"from-schema",
	"react",
	"arbiter",
	"react-schema",
] as const;
export const rcEdges: Record<string, readonly string[]> = {
	expressions: [],
	core: ["expressions"],
	declarative: ["core", "expressions"],
	"from-schema": ["core", "declarative", "expressions"],
	react: ["core", "expressions"],
	arbiter: ["core", "expressions"],
	"react-schema": ["core", "declarative", "from-schema", "react"],
};
export const initialVersions: Record<string, string> = {
	"@formbar/demos": "0.0.0",
	"@formbar/arbiter": "0.22.0",
	"@formbar/core": "0.22.3",
	"@formbar/declarative": "0.22.1",
	"@formbar/expressions": "0.14.3",
	"@formbar/from-schema": "0.22.0",
	"@formbar/react": "0.22.0",
	"@formbar/react-schema": "0.22.0",
};
export const consumed = [
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
] as const;
const changelogBlobs: Record<string, string> = {
	expressions: "be08f4e1336173f88cd3d935831f54f7255cba0e",
	core: "7bedaf047cdfca22ea671c24852bbce304be0384",
	arbiter: "2b7e0c86afb713009762be3b720f04431b8915b5",
	declarative: "32394386b02997398384b925c6a204909f5a23ff",
	"from-schema": "8afd4c3f2c1aa351263d59b61b2d7a01d50f42cc",
	react: "79d8556af213b8b072b8fcb6768ac40ce093eeb5",
	"react-schema": "f66832eddc616c87a6f5fe593bb55bd4906e169c",
};
const same = (actual: unknown, expected: unknown) => JSON.stringify(actual) === JSON.stringify(expected);
export function checkPre(pre: unknown): void {
	const state = pre as Record<string, unknown>;
	if (
		!state ||
		state.mode !== "pre" ||
		state.tag !== "rc" ||
		!same(state.changesets, consumed) ||
		!same(Object.entries((state.initialVersions as object) ?? {}).sort(), Object.entries(initialVersions).sort())
	)
		throw new Error("Unexpected Changesets prerelease state or consumed IDs");
}
export function checkManifest(name: string, value: unknown): void {
	const pkg = value as Record<string, unknown>;
	if (
		!rcPackages.includes(name as (typeof rcPackages)[number]) ||
		!pkg ||
		pkg.name !== `@formbar/${name}` ||
		pkg.version !== rcVersion ||
		pkg.private !== undefined ||
		pkg.publishConfig !== undefined
	)
		throw new Error(`invalid RC manifest ${name}`);
	const deps = pkg.dependencies as Record<string, string> | undefined;
	const peers = pkg.peerDependencies as Record<string, string> | undefined;
	const actual = Object.entries(deps ?? {}).filter(([key]) => key.startsWith("@formbar/"));
	const expected = rcEdges[name].map((edge) => [`@formbar/${edge}`, `^${rcVersion}`]);
	if (!same(actual.sort(), expected.sort()) || Object.keys(peers ?? {}).some((key) => key.startsWith("@formbar/")))
		throw new Error(`invalid RC dependency graph: ${name}`);
}
export function checkChangelog(name: string, text: string): void {
	const data = Buffer.from(text);
	const blob = createHash("sha1").update(`blob ${data.length}\0`).update(data).digest("hex");
	if (blob !== changelogBlobs[name]) throw new Error(`changelog ${name} drift`);
}
