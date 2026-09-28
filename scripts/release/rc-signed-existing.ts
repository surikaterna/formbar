/** #374: disabled GET-only verification of one ALREADY published exact version. */
import { createHash } from "node:crypto";
import type { ReadOnlyTransport } from "./rc-live-reads";
import { type ApprovedIdentity, signerPolicy } from "./rc-signed-identity";

const registry = "https://registry.npmjs.org";
const slsa = "https://slsa.dev/provenance/v1";
const publish = "https://github.com/npm/attestation/tree/main/specs/publish/v0.1";

export interface ApprovedVersion extends ApprovedIdentity {
	name: string;
	version: string;
	latest: string;
	rc?: string;
}
export interface AuditProof {
	// Runs npm 11.20.0 audit signatures --json --include-attestations on an
	// isolated exact installed version; errors/nonzero exits MUST be surfaced.
	audit(name: string, version: string): Promise<{ version: string; exit: number; json: unknown }>;
	// Pinned sigstore.verify(bundle, policy), not a boolean/caller identity claim.
	// Checks trusted Fulcio chain, signing-time validity, SCT, DSSE and Rekor.
	verify(bundle: unknown, policy: ReturnType<typeof signerPolicy>): Promise<void>;
}
export type ExistingVerdict = { status: "VERIFIED_EXISTING" | "UNVERIFIABLE"; reason: string; sha512?: string };

function obj(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid evidence");
	return value as Record<string, unknown>;
}

async function get(read: ReadOnlyTransport, url: string, binary = false) {
	const parsed = new URL(url);
	if (
		parsed.protocol !== "https:" ||
		parsed.host !== "registry.npmjs.org" ||
		parsed.username ||
		parsed.password ||
		parsed.search ||
		parsed.hash
	)
		throw new Error("foreign URL");
	const reply = await read.get(url, binary);
	if (reply.location || (reply.status >= 300 && reply.status < 400)) throw new Error("redirect");
	return reply;
}

async function snapshot(read: ReadOnlyTransport, approved: ApprovedVersion) {
	const base = `${registry}/${encodeURIComponent(approved.name)}`;
	const ver = await get(read, `${base}/${approved.version}`);
	const full = await get(read, base);
	if (ver.status === 404) throw new Error("absent version");
	if (ver.status !== 200 || full.status !== 200) throw new Error("incomplete reads");
	const pack = obj(full.body);
	const metadata = obj(ver.body);
	const listed = obj(obj(pack.versions)[approved.version]);
	const tags = obj(pack["dist-tags"]);
	if (
		pack.name !== approved.name ||
		metadata.name !== approved.name ||
		metadata.version !== approved.version ||
		(metadata.gitHead !== undefined && metadata.gitHead !== approved.commit) ||
		(metadata.gitHead === undefined) !== (listed.gitHead === undefined) ||
		(listed.gitHead !== undefined && listed.gitHead !== approved.commit) ||
		JSON.stringify(metadata.dist) !== JSON.stringify(listed.dist) ||
		tags.latest !== approved.latest ||
		tags.rc !== approved.rc ||
		tags.latest === approved.version
	)
		throw new Error("mixed reads");
	const dist = obj(metadata.dist);
	const attestation = obj(dist.attestations);
	if (
		typeof dist.tarball !== "string" ||
		typeof dist.integrity !== "string" ||
		!/^sha512-[A-Za-z0-9+/]{86}==$/.test(dist.integrity) ||
		typeof attestation.url !== "string" ||
		obj(attestation.provenance).predicateType !== slsa
	)
		throw new Error("unsigned or invalid dist");
	return { dist, attestation, tags: { latest: tags.latest, rc: tags.rc } };
}

function subject(entry: Record<string, unknown>, approved: ApprovedVersion, sha512: string) {
	const bundle = obj(entry.bundle);
	const envelope = obj(bundle.dsseEnvelope);
	if (
		envelope.payloadType !== "application/vnd.in-toto+json" ||
		typeof envelope.payload !== "string" ||
		!Array.isArray(envelope.signatures) ||
		envelope.signatures.length !== 1
	)
		throw new Error("invalid envelope");
	const statement = obj(JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8")));
	if (
		!Array.isArray(statement.subject) ||
		statement.subject.length !== 1 ||
		statement.predicateType !== entry.predicateType
	)
		throw new Error("ambiguous statement");
	const item = obj(statement.subject[0]);
	if (
		item.name !== `pkg:npm/${approved.name.replace("@", "%40")}@${approved.version}` ||
		obj(item.digest).sha512 !== sha512
	)
		throw new Error("wrong signed subject");
	return statement;
}

function signedRun(statement: Record<string, unknown>, approved: ApprovedVersion) {
	if (statement._type !== "https://in-toto.io/Statement/v1") throw new Error("wrong statement");
	const predicate = obj(statement.predicate);
	const definition = obj(predicate.buildDefinition);
	const workflow = obj(obj(definition.externalParameters).workflow);
	const source = `https://github.com/${approved.repository}`;
	const deps = definition.resolvedDependencies;
	if (
		definition.buildType !== "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1" ||
		obj(obj(predicate.runDetails).builder).id !== "https://github.com/actions/runner/github-hosted" ||
		workflow.repository !== source ||
		workflow.path !== approved.workflow ||
		workflow.ref !== approved.ref ||
		!Array.isArray(deps) ||
		deps.length !== 1 ||
		obj(deps[0]).uri !== `git+${source}@${approved.ref}` ||
		obj(obj(deps[0]).digest).gitCommit !== approved.commit ||
		obj(obj(predicate.runDetails).metadata).invocationId !==
			`${source}/actions/runs/${approved.runId}/attempts/${approved.attempt}`
	)
		throw new Error("wrong signed run");
}

async function attest(
	read: ReadOnlyTransport,
	proof: AuditProof,
	approved: ApprovedVersion,
	attestation: Record<string, unknown>,
	sha512: string,
) {
	const fetched = await get(read, attestation.url as string);
	if (fetched.status !== 200) throw new Error("attestation unavailable");
	const bundles = obj(fetched.body).attestations;
	if (!Array.isArray(bundles) || bundles.length !== 2) throw new Error("ambiguous bundles");
	const result = await proof.audit(approved.name, approved.version);
	if (result.exit !== 0 || result.version !== "11.20.0") throw new Error("unsupported CLI");
	const report = obj(result.json);
	if (
		!Array.isArray(report.invalid) ||
		report.invalid.length !== 0 ||
		!Array.isArray(report.missing) ||
		report.missing.length !== 0 ||
		!Array.isArray(report.verified)
	)
		throw new Error("invalid audit");
	const matches = report.verified.filter((v) => obj(v).name === approved.name);
	if (matches.length !== 1) throw new Error("ambiguous audit");
	const target = obj(matches[0]);
	if (
		target.version !== approved.version ||
		target.location !== `node_modules/${approved.name}` ||
		target.registry !== `${registry}/` ||
		JSON.stringify(target.attestations) !== JSON.stringify(attestation) ||
		JSON.stringify(target.attestationBundles) !== JSON.stringify(bundles)
	)
		throw new Error("inconsistent audit");
	const types = bundles.map((b) => obj(b).predicateType);
	if (types.filter((t) => t === slsa).length !== 1 || types.filter((t) => t === publish).length !== 1)
		throw new Error("wrong bundle types");
	for (const bundle of bundles) {
		const entry = obj(bundle);
		const statement = subject(entry, approved, sha512);
		if (entry.predicateType === slsa) {
			await proof.verify(entry.bundle, signerPolicy(approved));
			signedRun(statement, approved);
		}
	}
}

async function check(
	read: ReadOnlyTransport,
	proof: AuditProof,
	approved: ApprovedVersion,
	expectedBytes?: Uint8Array,
): Promise<string> {
	signerPolicy(approved);
	if (!/^(@[a-z0-9-]+\/)?[a-z0-9-]+$/.test(approved.name) || !/^\d+\.\d+\.\d+(-rc\.\d+)?$/.test(approved.version))
		throw new Error("invalid package identity");
	const first = await snapshot(read, approved);
	const tar = await get(read, first.dist.tarball as string, true);
	if (tar.status !== 200 || !(tar.bytes instanceof Uint8Array) || !tar.bytes.length || tar.bytes.length > 20_000_000)
		throw new Error("tarball unavailable");
	const sha512 = createHash("sha512").update(tar.bytes).digest("hex");
	if (
		expectedBytes &&
		(!expectedBytes.length ||
			expectedBytes.length > 20_000_000 ||
			createHash("sha512").update(expectedBytes).digest("hex") !== sha512)
	)
		throw new Error("prepacked bytes conflict");
	if (
		first.dist.integrity !== `sha512-${Buffer.from(sha512, "hex").toString("base64")}` ||
		typeof first.dist.shasum !== "string" ||
		first.dist.shasum !== createHash("sha1").update(tar.bytes).digest("hex")
	)
		throw new Error("wrong tarball bytes");
	await attest(read, proof, approved, first.attestation, sha512);
	const last = await snapshot(read, approved);
	if (JSON.stringify(first) !== JSON.stringify(last)) throw new Error("changed registry");
	return sha512;
}

/** Disabled #383 contract: absent gitHead ONLY with independent signed run AND exact prepacked bytes. */
export async function verifyPrepackedSignedVersion(
	read: ReadOnlyTransport,
	proof: AuditProof,
	approved: ApprovedVersion,
	expectedBytes: Uint8Array,
): Promise<ExistingVerdict> {
	try {
		return {
			status: "VERIFIED_EXISTING",
			reason: "signed prepacked bytes and run",
			sha512: await check(read, proof, approved, expectedBytes),
		};
	} catch {
		return { status: "UNVERIFIABLE", reason: "signed prepacked version not established" };
	}
}

/** No call site in the release workflow; NEVER use this result to authorize an absent future version. */
export async function verifyExistingSignedVersion(
	read: ReadOnlyTransport,
	proof: AuditProof,
	approved: ApprovedVersion,
): Promise<ExistingVerdict> {
	try {
		return {
			status: "VERIFIED_EXISTING",
			reason: "signed existing bytes only",
			sha512: await check(read, proof, approved),
		};
	} catch {
		return { status: "UNVERIFIABLE", reason: "signed existing version not established" };
	}
}
