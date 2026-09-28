/** #378: inert publish-method proof. No workflow or executable entrypoint imports this module. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkManifest, checkPre, rcPackages, rcVersion } from "./rc-reviewed-plan";

export { rcPackages } from "./rc-reviewed-plan";

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
	versions: Record<string, { gitHead?: string }>;
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
	checkPre(pre);
	const manifests: RcManifest[] = [];
	for (const directory of rcPackages) {
		const manifest = JSON.parse(
			await readFile(join(root, "packages", directory, "package.json"), "utf8"),
		) as RcManifest;
		if (
			manifest.name !== `@formbar/${directory}` ||
			manifests.some((entry) => entry.name === manifest.name) ||
			manifest.private ||
			manifest.version !== rcVersion ||
			(manifest.publishConfig?.access && manifest.publishConfig.access !== "public") ||
			(manifest.publishConfig?.registry && manifest.publishConfig.registry !== "https://registry.npmjs.org/") ||
			(manifest.publishConfig?.tag && manifest.publishConfig.tag !== "rc") ||
			manifest.publishConfig?.directory !== undefined ||
			typeof pre.initialVersions?.[manifest.name] !== "string"
		)
			throw new Error(`invalid RC manifest ${directory}`);
		checkManifest(directory, manifest);
		const log = await readFile(join(root, "packages", directory, "CHANGELOG.md"), "utf8");
		if (!log.startsWith(`# @formbar/${directory}\n\n## ${rcVersion}\n`))
			throw new Error(`invalid RC changelog ${directory}`);
		manifests.push(manifest);
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
