/** #371: GET-only observations. Neither these reads nor #366 authorize a release. */
import { createHash } from "node:crypto";
import { type RcPlan, type RcRead, type SourceWitness, inspectRcRegistry, sourceCheck } from "./rc-registry-proof";

const names = ["arbiter", "core", "declarative", "from-schema", "react", "react-schema"] as const;
const version = "0.23.0-rc.0";
const registry = "https://registry.npmjs.org";
const repo = "https://api.github.com/repos/surikaterna/formbar";
const conflict = /mismatch|conflict|disagrees|drift|nondeterministic/;
function safeReason(error: unknown): string {
	if (!(error instanceof Error)) return "read failed";
	return /^(invalid JSON object|empty\/invalid pack bytes|nondeterministic pack bytes|redirect denied|packument identity mismatch|latest tag drift|rc tag drift|404 disagrees with packument|version\/packument disagreement|published identity, gitHead or rc mismatch|metadata digest or tarball conflict|tarball bytes conflict|foreign\/lightweight tag|foreign annotated tag|release conflict|commit tree drift|tarball exceeds read bound)$/.test(
		error.message,
	) ||
		/^(version|packument|tarball) HTTP (\d{3})$/.test(error.message) ||
		/^GitHub GET (\d{3})$/.test(error.message)
		? error.message
		: "read failed";
}
export type Observation = "ABSENT" | "EXISTING" | "CONFLICT" | "UNVERIFIABLE";
export type ReadReply = { status: number; body?: unknown; bytes?: Uint8Array; location?: string };
export interface ReadOnlyTransport {
	get(url: string, binary?: boolean): Promise<ReadReply>;
}
export interface PackSource {
	// Caller must pin Node/npm CLI, lifecycle, audited checkout and dependencies; two fresh packs per package.
	pack(name: string, attempt: 1 | 2): Promise<Uint8Array>;
}
export interface PackageEvidence {
	name: string;
	observation: Observation;
	reason: string;
	gets: { url: string; status: number }[];
	local?: { integrity: string; shasum: string };
}
export interface LivePlan {
	decision: "UNVERIFIABLE";
	packages: PackageEvidence[];
	classification?: RcPlan;
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid JSON object");
	return value as Record<string, unknown>;
}

function digest(bytes: Uint8Array) {
	if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new Error("empty/invalid pack bytes");
	return {
		integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
		shasum: createHash("sha1").update(bytes).digest("hex"),
	};
}

function equal(a: unknown, b: unknown): boolean {
	return typeof a === "string" && a === b;
}

function exactTarball(url: unknown, name: string): url is string {
	if (typeof url !== "string") return false;
	try {
		const parsed = new URL(url);
		return (
			parsed.protocol === "https:" &&
			parsed.host === "registry.npmjs.org" &&
			parsed.username === "" &&
			parsed.password === "" &&
			parsed.search === "" &&
			parsed.hash === "" &&
			parsed.pathname === `/@formbar/${name}/-/${name}-${version}.tgz`
		);
	} catch {
		return false;
	}
}

function publishedDist(
	metadata: Record<string, unknown>,
	listed: unknown,
	tags: Record<string, unknown>,
	source: SourceWitness,
	name: string,
	local: { integrity: string; shasum: string },
): string {
	if (JSON.stringify(record(listed)) !== JSON.stringify(metadata)) throw new Error("version/packument disagreement");
	if (
		metadata.name !== `@formbar/${name}` ||
		metadata.version !== version ||
		metadata.gitHead !== source.commit ||
		tags.rc !== version
	)
		throw new Error("published identity, gitHead or rc mismatch");
	const dist = record(metadata.dist);
	if (!equal(dist.integrity, local.integrity) || !equal(dist.shasum, local.shasum) || !exactTarball(dist.tarball, name))
		throw new Error("metadata digest or tarball conflict");
	return dist.tarball;
}

async function inspectPackage(
	read: ReadOnlyTransport,
	pack: PackSource,
	source: SourceWitness,
	name: string,
): Promise<PackageEvidence> {
	const evidence: PackageEvidence = {
		name: `@formbar/${name}`,
		observation: "UNVERIFIABLE",
		reason: "incomplete reads",
		gets: [],
	};
	try {
		await inspectPackageReads(read, pack, source, name, evidence);
	} catch (error) {
		evidence.reason = safeReason(error);
		evidence.observation = conflict.test(evidence.reason) ? "CONFLICT" : "UNVERIFIABLE";
	}
	return evidence;
}

function recordedGet(read: ReadOnlyTransport, evidence: PackageEvidence) {
	return async (url: string, binary = false) => {
		const reply = await read.get(url, binary);
		evidence.gets.push({ url, status: reply.status });
		if (reply.location || (reply.status >= 300 && reply.status < 400)) throw new Error("redirect denied");
		return reply;
	};
}

async function inspectPackageReads(
	read: ReadOnlyTransport,
	pack: PackSource,
	source: SourceWitness,
	name: string,
	evidence: PackageEvidence,
): Promise<void> {
	const local = digest(await pack.pack(name, 1));
	if (!equal(local.integrity, digest(await pack.pack(name, 2)).integrity))
		throw new Error("nondeterministic pack bytes");
	evidence.local = local;
	const get = recordedGet(read, evidence);
	const encoded = encodeURIComponent(evidence.name);
	const versionReply = await get(`${registry}/${encoded}/${version}`);
	const packumentReply = await get(`${registry}/${encoded}`);
	if (packumentReply.status !== 200) throw new Error(`packument HTTP ${packumentReply.status}`);
	const packument = record(packumentReply.body);
	if (packument.name !== evidence.name) throw new Error("packument identity mismatch");
	const versions = record(packument.versions);
	const tags = record(packument["dist-tags"]);
	if (tags.latest !== source.initialLatest[name] || tags.latest === version) throw new Error("latest tag drift");
	if (tags.rc !== undefined && tags.rc !== version) throw new Error("rc tag drift");
	if (versionReply.status === 404) {
		if (Object.hasOwn(versions, version) || tags.rc === version) throw new Error("404 disagrees with packument");
		evidence.reason = "404 and packument absence; npm package authorization not independently established";
		return;
	}
	if (versionReply.status !== 200) throw new Error(`version HTTP ${versionReply.status}`);
	const metadata = record(versionReply.body);
	const tarball = publishedDist(metadata, versions[version], tags, source, name, local);
	const tar = await get(tarball, true);
	if (tar.status !== 200 || !tar.bytes) throw new Error(`tarball HTTP ${tar.status}`);
	const remote = digest(tar.bytes);
	if (remote.integrity !== local.integrity || remote.shasum !== local.shasum) throw new Error("tarball bytes conflict");
	evidence.observation = "EXISTING";
	evidence.reason = "matching metadata and downloaded bytes; signed provenance and publisher remain unverified";
}

async function inspectGithub(read: ReadOnlyTransport, source: SourceWitness): Promise<void> {
	const get = async (url: string, absent = false) => {
		const reply = await read.get(url);
		if (absent && reply.status === 404) return undefined;
		if (reply.status !== 200 || reply.location) throw new Error(`GitHub GET ${reply.status}`);
		return record(reply.body);
	};
	const commit = await get(`${repo}/commits/${source.commit}`);
	if (record(record(commit?.commit).tree).sha !== source.tree) throw new Error("commit tree drift");
	for (const name of names) {
		const tag = `@formbar/${name}@${version}`;
		const ref = await get(`${repo}/git/ref/tags/${encodeURIComponent(tag)}`, true);
		if (ref) {
			const obj = record(ref.object);
			if (ref.ref !== `refs/tags/${tag}` || obj.type !== "tag" || typeof obj.sha !== "string")
				throw new Error("foreign/lightweight tag");
			const annotated = await get(`${repo}/git/tags/${obj.sha}`);
			if (
				annotated?.sha !== obj.sha ||
				annotated.tag !== tag ||
				record(annotated.object).type !== "commit" ||
				record(annotated.object).sha !== source.commit
			)
				throw new Error("foreign annotated tag");
		}
		const release = await get(`${repo}/releases/tags/${encodeURIComponent(tag)}`, true);
		const notes = source.changelogs[name]?.split(`## ${version}`)[1]?.split("\n## ")[0]?.trim();
		if (
			release &&
			(!ref ||
				release.tag_name !== tag ||
				release.name !== `@formbar/${name} ${version}` ||
				release.draft !== false ||
				release.prerelease !== true ||
				release.body !== notes)
		)
			throw new Error("release conflict");
	}
}

/** A live observation may feed the offline #366 classifier, never its authority or a write gate. */
export async function inspectLiveRc(
	read: ReadOnlyTransport,
	pack: PackSource,
	source: SourceWitness,
	offline?: RcRead,
): Promise<LivePlan> {
	const packages: PackageEvidence[] = [];
	try {
		sourceCheck(source);
	} catch (error) {
		const reason = `source: ${safeReason(error)}`;
		return {
			decision: "UNVERIFIABLE",
			packages: names.map((name) => ({
				name: `@formbar/${name}`,
				observation: "UNVERIFIABLE",
				reason,
				gets: [],
			})),
		};
	}
	for (const name of names) packages.push(await inspectPackage(read, pack, source, name));
	try {
		await inspectGithub(read, source);
	} catch (error) {
		const reason = safeReason(error);
		for (const item of packages) {
			item.observation = conflict.test(reason) || /foreign|release/.test(reason) ? "CONFLICT" : "UNVERIFIABLE";
			item.reason = `GitHub: ${reason}`;
		}
	}
	let classification: RcPlan | undefined;
	if (offline) {
		try {
			classification = await inspectRcRegistry(offline, source);
		} catch {
			/* Offline conflicts cannot authorize reads. */
		}
	}
	return { decision: "UNVERIFIABLE", packages, ...(classification ? { classification } : {}) };
}

/** Explicit injected credential, no ambient token or redirect following. Never log response bodies/headers. */
export function createRegistryGitHubReader(
	npmToken: string,
	githubToken: string,
	fetcher: typeof fetch = fetch,
): ReadOnlyTransport {
	return {
		async get(url, binary) {
			const parsed = new URL(url);
			if (
				parsed.protocol !== "https:" ||
				!["registry.npmjs.org", "api.github.com"].includes(parsed.host) ||
				parsed.username ||
				parsed.password ||
				parsed.hash
			)
				throw new Error("untrusted GET host");
			const token = parsed.host === "registry.npmjs.org" ? npmToken : githubToken;
			if (!token) throw new Error("missing read credential");
			const response = await fetcher(url, {
				method: "GET",
				redirect: "manual",
				signal: AbortSignal.timeout(10_000),
				headers: { Authorization: `Bearer ${token}` },
			});
			if (binary && Number(response.headers.get("content-length")) > 20_000_000)
				throw new Error("tarball exceeds read bound");
			return {
				status: response.status,
				...(response.headers.get("location") ? { location: "redirect" } : {}),
				...(response.status === 200
					? binary
						? { bytes: new Uint8Array(await response.arrayBuffer()) }
						: { body: await response.json() }
					: {}),
			};
		},
	};
}
