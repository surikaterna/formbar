/** #378: inert publish-method proof. No workflow or executable entrypoint imports this module. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { consumed } from "./rc-source-check";

export const rcPackages = ["core", "declarative", "from-schema", "react", "arbiter", "react-schema"] as const;
const expected = new Set(rcPackages.map((name) => `@formbar/${name}`));
const edges: Record<string, string[]> = {
	core: [],
	declarative: ["core"],
	"from-schema": ["core", "declarative"],
	react: ["core"],
	arbiter: ["core"],
	"react-schema": ["core", "declarative", "from-schema", "react"],
};
const initialVersions: Record<string, string> = {
	"@formbar/arbiter": "0.22.0",
	"@formbar/core": "0.22.3",
	"@formbar/declarative": "0.22.1",
	"@formbar/from-schema": "0.22.0",
	"@formbar/react": "0.22.0",
	"@formbar/react-schema": "0.22.0",
	"@formbar/expressions": "0.14.3",
	"@formbar/demos": "0.0.0",
};

export interface RcManifest {
	name: string;
	version: string;
	private?: boolean;
	publishConfig?: { access?: string; registry?: string; tag?: string; directory?: string };
	dependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}
export interface RegistrySnapshot {
	name: string;
	latest: string;
	rc?: string;
	versions: Record<string, { gitHead: string }>;
}
export interface PublishMethod {
	// All reads must be fresh, bounded packument reads. Never return cached npm info.
	read(name: string): Promise<RegistrySnapshot>;
}
export interface PublishContext {
	commit: string;
	node: string;
	npm: string;
	oidc: boolean;
	approved: boolean;
	credentials: { token?: string; npmToken?: string; userconfig?: string };
}

function assertContext(context: PublishContext): void {
	if (!/^[a-f0-9]{40}$/.test(context.commit) || context.node !== "22.23.2" || context.npm !== "11.20.0")
		throw new Error("unsupported source or toolchain");
	if (!context.oidc || !context.approved || Object.values(context.credentials).some(Boolean))
		throw new Error("OIDC approval required; bearer credentials forbidden");
}

function assertSnapshot(snapshot: RegistrySnapshot, manifest: RcManifest): boolean {
	if (
		snapshot.name !== manifest.name ||
		!/^\d+\.\d+\.\d+$/.test(snapshot.latest) ||
		!snapshot.versions[snapshot.latest]
	)
		throw new Error(`stable latest prerequisite missing: ${manifest.name}`);
	if (snapshot.rc !== undefined && !/^\d+\.\d+\.\d+-rc\.\d+$/.test(snapshot.rc))
		throw new Error(`invalid rc tag: ${manifest.name}`);
	return Object.hasOwn(snapshot.versions, manifest.version);
}

export async function loadRcManifests(root: string): Promise<RcManifest[]> {
	const pre = JSON.parse(await readFile(join(root, ".changeset/pre.json"), "utf8"));
	// This loader accepts the versioned #298 source, not the unversioned main proposal.
	// An empty pre.changesets is a future candidate plan and cannot identify published input.
	if (
		pre.mode !== "pre" ||
		pre.tag !== "rc" ||
		!Array.isArray(pre.changesets) ||
		JSON.stringify(pre.changesets) !== JSON.stringify(consumed)
	)
		throw new Error("invalid consumed pre mode");
	if (
		JSON.stringify(Object.entries(pre.initialVersions ?? {}).sort()) !==
		JSON.stringify(Object.entries(initialVersions).sort())
	)
		throw new Error("invalid RC initial versions");
	const manifests: RcManifest[] = [];
	for (const directory of rcPackages) {
		const manifest = JSON.parse(
			await readFile(join(root, "packages", directory, "package.json"), "utf8"),
		) as RcManifest;
		if (
			!expected.has(manifest.name) ||
			manifests.some((entry) => entry.name === manifest.name) ||
			manifest.private ||
			manifest.version !== "0.23.0-rc.0" ||
			(manifest.publishConfig?.access && manifest.publishConfig.access !== "public") ||
			(manifest.publishConfig?.registry && manifest.publishConfig.registry !== "https://registry.npmjs.org/") ||
			(manifest.publishConfig?.tag && manifest.publishConfig.tag !== "rc") ||
			manifest.publishConfig?.directory !== undefined ||
			typeof pre.initialVersions?.[manifest.name] !== "string"
		)
			throw new Error(`invalid RC manifest ${directory}`);
		manifests.push(manifest);
	}
	for (const [index, manifest] of manifests.entries()) {
		const required = new Set((edges[rcPackages[index]] ?? []).map((edge) => `@formbar/${edge}`));
		const requiresExpressions = rcPackages[index] !== "react-schema";
		const actual = Object.keys(manifest.dependencies ?? {}).filter((name) => expected.has(name));
		if (actual.length !== required.size || actual.some((name) => !required.has(name)))
			throw new Error(`invalid RC dependency graph: ${manifest.name}`);
		if (manifest.dependencies?.["@formbar/expressions"] !== (requiresExpressions ? "^0.14.3" : undefined))
			throw new Error(`invalid stable prerequisite ${manifest.name} -> @formbar/expressions`);
		for (const [name, range] of Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })) {
			if (expected.has(name) && (!required.has(name) || range !== "^0.23.0-rc.0"))
				throw new Error(`invalid RC dependency ${manifest.name} -> ${name}`);
			if (expected.has(name) && !actual.includes(name))
				throw new Error(`invalid peer-only RC dependency ${manifest.name} -> ${name}`);
			if (name === "@formbar/expressions" && range !== "^0.14.3")
				throw new Error(`invalid stable prerequisite ${manifest.name} -> ${name}`);
		}
		for (const name of required)
			if (manifest.dependencies?.[name] !== "^0.23.0-rc.0")
				throw new Error(`missing RC dependency ${manifest.name} -> ${name}`);
	}
	return manifests;
}

/** Standalone preflight only: signed verification and publish wiring belong to #363. */
export async function provePublishMethod(root: string, context: PublishContext, method: PublishMethod): Promise<void> {
	assertContext(context);
	const manifests = await loadRcManifests(root);
	for (const manifest of manifests) {
		const snapshot = await method.read(manifest.name);
		const exists = assertSnapshot(snapshot, manifest);
		if (exists && snapshot.rc !== manifest.version) throw new Error(`missing or wrong rc dist-tag: ${manifest.name}`);
		if (exists && snapshot.versions[manifest.version]?.gitHead !== context.commit)
			throw new Error(`foreign existing ${manifest.name}`);
	}
	// No caller-supplied boolean can establish signed bytes, provenance or run identity.
	throw new Error("SIGNED_VERIFICATION_UNAVAILABLE");
}
