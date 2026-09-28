/** #378: inert publish-method proof. No workflow or executable entrypoint imports this module. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

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
	// Must verify actual tarball bytes, npm audit signatures and signed same-run provenance.
	verify(name: string, version: string, sha: string, latest: string, rc: string | undefined): Promise<boolean>;
	// Injected process runner; the helper never spawns npm itself.
	run(program: "npm", args: string[]): Promise<{ code: number }>;
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
	if (pre.mode !== "pre" || pre.tag !== "rc" || !Array.isArray(pre.changesets) || pre.changesets.length !== 0)
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
		for (const edge of edges[rcPackages[index]] ?? []) {
			if (manifest.dependencies?.[`@formbar/${edge}`] !== "^0.23.0-rc.0")
				throw new Error(`missing RC dependency ${manifest.name} -> ${edge}`);
		}
		for (const [name, range] of Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })) {
			if (expected.has(name) && range !== "^0.23.0-rc.0")
				throw new Error(`invalid RC dependency ${manifest.name} -> ${name}`);
			if (name === "@formbar/expressions" && range !== "^0.14.3")
				throw new Error(`invalid stable prerequisite ${manifest.name} -> ${name}`);
		}
	}
	return manifests;
}

/** Standalone proof only: no GO recovery or registry writes are reachable from release.yml. */
export async function provePublishMethod(root: string, context: PublishContext, method: PublishMethod): Promise<void> {
	assertContext(context);
	const manifests = await loadRcManifests(root);
	const states = new Map<string, RegistrySnapshot>();
	// Finish all prewrite checks before the first process invocation.
	for (const manifest of manifests) {
		const snapshot = await method.read(manifest.name);
		const exists = assertSnapshot(snapshot, manifest);
		if (
			exists &&
			(snapshot.versions[manifest.version]?.gitHead !== context.commit ||
				!(await method.verify(manifest.name, manifest.version, context.commit, snapshot.latest, snapshot.rc)))
		)
			throw new Error(`foreign or unsigned existing ${manifest.name}`);
		states.set(manifest.name, snapshot);
	}
	for (const [index, manifest] of manifests.entries()) {
		const before = states.get(manifest.name);
		if (!before) throw new Error("missing prewrite snapshot");
		// Check all six again before each write: a changed latest never authorizes the next write.
		for (const earlier of manifests) {
			const current = await method.read(earlier.name);
			if (JSON.stringify(current) !== JSON.stringify(states.get(earlier.name)))
				throw new Error("registry changed before write");
		}
		if (Object.hasOwn(before.versions, manifest.version)) continue;
		const result = await method.run("npm", [
			"publish",
			`./packages/${rcPackages[index]}`,
			"--tag",
			"rc",
			"--access",
			"public",
			"--provenance",
		]);
		if (result.code !== 0) throw new Error(`publish failed: ${manifest.name}`);
		const after = await method.read(manifest.name);
		if (
			after.latest !== before.latest ||
			after.rc !== manifest.version ||
			after.versions[manifest.version]?.gitHead !== context.commit ||
			!(await method.verify(manifest.name, manifest.version, context.commit, before.latest, manifest.version))
		)
			throw new Error(`unverified publish: ${manifest.name}`);
		states.set(manifest.name, after);
	}
}
