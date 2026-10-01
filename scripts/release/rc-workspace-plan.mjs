import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const rcEdges = {
	expressions: [],
	core: ["expressions"],
	declarative: ["core", "expressions"],
	"fsx-authoring": ["declarative", "expressions"],
	"from-schema": ["core", "declarative", "expressions"],
	react: ["core", "expressions"],
	arbiter: ["core", "expressions"],
	"react-schema": ["core", "declarative", "expressions", "from-schema", "react"],
};
export const rcPackages = Object.keys(rcEdges);
export const kaladaProductionDependencies = {
	"@formbar/declarative": { "@kalada/core": "0.6.0", "@kalada/syntax": "0.1.0" },
	"@formbar/fsx-authoring": { "@kalada/syntax": "0.1.0", "@kalada/provider-routing": "0.1.0" },
};
const rc = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-rc\.(0|[1-9]\d*)$/;

export function checkProductionDeclarations(manifests) {
	for (const [name, dependencies] of Object.entries(kaladaProductionDependencies)) {
		const manifest = manifests.find((manifest) => manifest.name === name);
		for (const [dependency, version] of Object.entries(dependencies))
			if (manifest?.dependencies?.[dependency] !== version)
				throw new Error(
					`production registry gate: ${name} must directly declare ${dependency}@${version} after Kalada publication (#317)`,
				);
	}
}

export function checkRcManifests(manifests) {
	const byName = new Map(manifests.map((manifest) => [manifest.name, manifest]));
	if (manifests.length !== 8 || byName.size !== 8) throw new Error("incomplete eight-package RC plan");
	for (const name of rcPackages) {
		const manifest = byName.get(`@formbar/${name}`);
		if (
			!manifest ||
			!rc.test(manifest.version) ||
			manifest.private !== undefined ||
			manifest.publishConfig !== undefined
		)
			throw new Error(`invalid RC manifest ${name}`);
		const edges = Object.keys(manifest.dependencies ?? {})
			.filter((key) => key.startsWith("@formbar/"))
			.sort();
		if (
			JSON.stringify(edges) !== JSON.stringify(rcEdges[name].map((edge) => `@formbar/${edge}`).sort()) ||
			Object.keys(manifest.peerDependencies ?? {}).some((key) => key.startsWith("@formbar/"))
		)
			throw new Error(`invalid RC dependency graph: ${name}`);
		for (const edge of rcEdges[name]) {
			const target = byName.get(`@formbar/${edge}`).version.match(rc);
			const floor = manifest.dependencies[`@formbar/${edge}`].replace(/^\^/, "").match(rc);
			if (
				!manifest.dependencies[`@formbar/${edge}`].startsWith("^") ||
				!floor ||
				floor.slice(1, 4).join(".") !== target.slice(1, 4).join(".") ||
				BigInt(floor[4]) > BigInt(target[4])
			)
				throw new Error(`invalid RC dependency graph: ${name} -> ${edge}`);
		}
	}
}

export function readRcPlan(root) {
	const names = readdirSync(resolve(root, "packages"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
	if (JSON.stringify(names) !== JSON.stringify([...rcPackages].sort()))
		throw new Error("unexpected package workspace closure");
	const manifests = rcPackages.map((name) =>
		JSON.parse(readFileSync(resolve(root, `packages/${name}/package.json`), "utf8")),
	);
	checkRcManifests(manifests);
	const pre = JSON.parse(readFileSync(resolve(root, ".changeset/pre.json"), "utf8"));
	if (
		Object.keys(pre).sort().join(",") !== "changesets,initialVersions,mode,tag" ||
		pre.mode !== "pre" ||
		pre.tag !== "rc" ||
		!Array.isArray(pre.changesets) ||
		pre.changesets.some((id) => typeof id !== "string" || !id.length) ||
		new Set(pre.changesets).size !== pre.changesets.length ||
		rcPackages.some((name) => typeof pre.initialVersions?.[`@formbar/${name}`] !== "string")
	)
		throw new Error("invalid active RC prerelease state");
	return manifests;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const manifests = readRcPlan(process.cwd());
	checkProductionDeclarations(manifests);
	for (const manifest of manifests) console.log(`${manifest.name.slice(9)}\t${manifest.version}`);
}
