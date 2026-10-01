/** #366: offline, read-only reconciliation; never a publish authorization or write entrypoint. */
import { checkManifest, checkPre, initialVersions, rcPackages, rcVersion } from "./rc-reviewed-plan";

const names = rcPackages;
const sha = /^[a-f0-9]{40}$/;
const integrity = /^sha512-[A-Za-z0-9+/]+={0,2}$/;
const repo = "/repos/surikaterna/formbar";
const version = rcVersion;

export type Reply = { status: number; body?: unknown };
export interface RcRead {
	get(url: string): Promise<Reply>;
}
export interface ArtifactWitness {
	name: string;
	version: string;
	commit: string;
	integrity: string; // SHA512 of reproducibly packed bytes from the audited source
	shasum: string;
	tarball: string;
	provenance: { subjectIntegrity: string; repository: string; commit: string; workflow: string };
}
export interface SourceWitness {
	commit: string;
	tree: string;
	pre: unknown;
	manifests: Record<string, unknown>;
	changelogs: Record<string, string>;
	artifacts: Record<string, ArtifactWitness | undefined>;
	initialLatest: Record<string, string>;
}
export type RcState = "absent" | "identical" | "partial-same-sha" | "conflict";
export interface RcPlan {
	state: RcState;
	remaining: string[];
	// Always blocked: metadata/fixtures cannot authorize a write without live private verification (#363).
	blocked: string[];
}

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("incomplete read-only evidence");
	return value as Record<string, unknown>;
}
function requireProof(condition: unknown, reason: string): asserts condition {
	if (!condition) throw new Error(reason);
}
function response(reply: Reply, absent = false): Record<string, unknown> | undefined {
	if (absent && reply.status === 404) return undefined;
	requireProof(reply.status === 200, `read-only GET failed (${reply.status})`);
	return object(reply.body);
}
export function sourceCheck(source: SourceWitness): void {
	requireProof(sha.test(source.commit) && sha.test(source.tree), "invalid audited commit/tree");
	checkPre(source.pre);
	for (const entries of [source.manifests, source.changelogs, source.artifacts, source.initialLatest])
		requireProof(
			JSON.stringify(Object.keys(entries).sort()) === JSON.stringify([...names].sort()),
			"unexpected RC package set",
		);
	for (const name of names) {
		checkManifest(name, source.manifests[name]);
		requireProof(source.initialLatest[name] === initialVersions[`@formbar/${name}`], `stable latest ${name} drift`);
		requireProof(
			source.changelogs[name]?.startsWith(`# @formbar/${name}\n\n## ${version}\n`),
			`changelog ${name} drift`,
		);
	}
}

function checkArtifact(name: string, published: Record<string, unknown>, source: SourceWitness): void {
	const witness = source.artifacts[name];
	requireProof(
		witness && witness.name === `@formbar/${name}` && witness.version === version && witness.commit === source.commit,
		`missing exact pack ${name}`,
	);
	const dist = object(published.dist);
	requireProof(
		published.name === witness.name &&
			published.version === version &&
			(published.gitHead === undefined || published.gitHead === source.commit),
		`registry identity ${name} conflict`,
	);
	requireProof(integrity.test(witness.integrity) && sha.test(witness.shasum), `invalid pack digest ${name}`);
	requireProof(
		dist.integrity === witness.integrity && dist.shasum === witness.shasum && dist.tarball === witness.tarball,
		`artifact ${name} conflict`,
	);
	const proof = object(witness.provenance);
	requireProof(
		proof.subjectIntegrity === witness.integrity &&
			proof.repository === "surikaterna/formbar" &&
			proof.commit === source.commit &&
			proof.workflow === "release.yml",
		`provenance ${name} conflict`,
	);
	// Metadata consistency is not verification of tarball bytes or registry attestation.
	const attestation = object(dist.provenance);
	requireProof(
		JSON.stringify(attestation) === JSON.stringify(proof),
		`registry attestation ${name} unavailable or conflicting`,
	);
}

function checkTag(tag: Record<string, unknown> | undefined, commit: string, tagName: string): void {
	if (!tag) return;
	requireProof(tag.ref && object(tag.object).type === "tag", "lightweight tag");
	const annotated = object(tag.annotated);
	requireProof(
		tag.ref === `refs/tags/${tagName}` &&
			annotated.tag === tagName &&
			object(annotated.object).type === "commit" &&
			object(annotated.object).sha === commit,
		"foreign annotated tag",
	);
	requireProof(object(tag.object).sha === annotated.sha, "annotated tag object mismatch");
}

/** Pure shape model only; the package-scoped request URL and OIDC claims need independent proof. NEVER exchange here. */
export function inspectExchange(packageName: string, reply: Reply): boolean {
	if (!names.some((name) => packageName === `@formbar/${name}`)) return false;
	if (reply.status !== 201) return false;
	const body = object(reply.body);
	return (
		body.token_type === "oidc" &&
		typeof body.token === "string" &&
		body.token.length > 0 &&
		typeof body.created === "string" &&
		typeof body.expires === "string" &&
		Date.parse(body.expires) > Date.parse(body.created)
	);
}

async function inspectGithubArtifacts(read: RcRead, source: SourceWitness, name: string): Promise<boolean> {
	const tagName = `@formbar/${name}@${version}`;
	const ref = response(await read.get(`${repo}/git/ref/tags/${encodeURIComponent(tagName)}`), true);
	if (ref) {
		requireProof(object(ref.object).type === "tag", "lightweight tag");
		const tagObject = response(await read.get(`${repo}/git/tags/${object(ref.object).sha}`));
		checkTag({ ...ref, annotated: tagObject }, source.commit, tagName);
	}
	const release = response(await read.get(`${repo}/releases/tags/${encodeURIComponent(tagName)}`), true);
	const notes = source.changelogs[name]?.split(`## ${version}`)[1]?.split("\n## ")[0]?.trim();
	requireProof(
		!release ||
			(ref &&
				release.tag_name === tagName &&
				release.name === `@formbar/${name} ${version}` &&
				release.draft === false &&
				release.prerelease === true &&
				typeof release.body === "string" &&
				release.body.trim() === notes),
		`release ${name} conflict`,
	);
	return Boolean(ref || release);
}

async function inspectPackage(
	read: RcRead,
	source: SourceWitness,
	name: string,
): Promise<{ published: boolean; blocked?: string }> {
	const packageName = `@formbar/${name}`;
	const encoded = encodeURIComponent(packageName);
	const published = response(await read.get(`https://registry.npmjs.org/${encoded}/${version}`), true);
	const tags = response(await read.get(`https://registry.npmjs.org/-/package/${encoded}/dist-tags`));
	requireProof(
		tags?.latest === source.initialLatest[name] && typeof tags.latest === "string" && tags.latest !== version,
		`latest ${name} changed`,
	);
	requireProof(tags.rc === undefined || tags.rc === version, `rc dist-tag ${name} conflict`);
	const reserved = await inspectGithubArtifacts(read, source, name);
	if (published) {
		checkArtifact(name, published, source);
		requireProof(tags.rc === version, `published ${name} lacks rc tag`);
		return {
			published: true,
			blocked:
				published.gitHead === undefined
					? `NEEDS_SIGNED_PROOF ${name} UNVERIFIABLE`
					: `artifact/attestation ${name} UNVERIFIABLE`,
		};
	}
	requireProof(!reserved && tags.rc === undefined, `absent ${name} has reserved tag/release/dist-tag`);
	return { published: false, blocked: `publisher ${name} UNVERIFIABLE` };
}

export async function inspectRcRegistry(read: RcRead, source: SourceWitness): Promise<RcPlan> {
	sourceCheck(source);
	const commit = response(await read.get(`${repo}/commits/${source.commit}`));
	requireProof(object(object(commit?.commit).tree).sha === source.tree, "audited tree conflict");
	const remaining: string[] = [];
	const blocked: string[] = [];
	let existing = 0;
	for (const name of names) {
		const result = await inspectPackage(read, source, name);
		if (result.published) existing++;
		else remaining.push(`@formbar/${name}`);
		if (result.blocked) blocked.push(result.blocked);
	}
	const state = existing === 0 ? "absent" : existing === names.length ? "identical" : "partial-same-sha";
	if (state === "partial-same-sha")
		blocked.push("new attempt=1 protected-main run and registry reconciliation required before recovery");
	return { state, remaining, blocked };
}
