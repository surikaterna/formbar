/** #382 disabled adapter: no workflow entrypoint, credentials, or registry writer. */
import { createHash } from "node:crypto";
import type { ReadOnlyTransport } from "./rc-live-reads";
import { rcPackages, rcVersion } from "./rc-reviewed-plan";
import { type ApprovedVersion, type AuditProof, verifyPrepackedSignedVersion } from "./rc-signed-existing";

export interface Candidate {
	name: string;
	version: string;
	bytes: Uint8Array;
	expectedSha512: string;
}

export interface ReadSnapshot {
	name: string;
	latest: string;
	rc?: string;
	versions: Record<string, { gitHead?: string }>;
}

export interface TarballAdapter {
	// This injection is NOT a live authorization. The release workflow never calls it.
	read(name: string): Promise<ReadSnapshot>;
	publish(candidate: Candidate, args: readonly string[]): Promise<void>;
	registry: ReadOnlyTransport;
	proof: AuditProof;
}

function inspect(snapshot: ReadSnapshot, approved: ApprovedVersion): boolean {
	if (
		snapshot.name !== approved.name ||
		snapshot.latest !== approved.latest ||
		!Object.hasOwn(snapshot.versions, approved.latest) ||
		(snapshot.rc !== undefined && !/^\d+\.\d+\.\d+-rc\.\d+$/.test(snapshot.rc))
	)
		throw new Error("unstable or incomplete registry snapshot");
	const existing = snapshot.versions[approved.version];
	if (existing?.gitHead !== undefined && existing.gitHead !== approved.commit) throw new Error("foreign gitHead");
	if (existing && snapshot.rc !== approved.version) throw new Error("wrong rc tag");
	return Boolean(existing);
}

function validateCandidates(candidates: readonly Candidate[], identities: readonly ApprovedVersion[]): void {
	if (
		candidates.length !== rcPackages.length ||
		identities.length !== rcPackages.length ||
		candidates.some(
			(candidate, i) =>
				candidate.name !== `@formbar/${rcPackages[i]}` ||
				candidate.version !== rcVersion ||
				candidate.bytes.length === 0 ||
				candidate.bytes.length > 20_000_000 ||
				!/^[a-f0-9]{128}$/.test(candidate.expectedSha512) ||
				createHash("sha512").update(candidate.bytes).digest("hex") !== candidate.expectedSha512 ||
				identities[i]?.name !== candidate.name ||
				identities[i]?.version !== candidate.version ||
				identities[i]?.rc !== candidate.version ||
				identities[i]?.commit !== identities[0]?.commit ||
				identities[i]?.repository !== identities[0]?.repository ||
				identities[i]?.runId !== identities[0]?.runId ||
				identities[i]?.attempt !== identities[0]?.attempt,
		)
	)
		throw new Error("unreviewed candidate plan");
}

/** Single-write reconciliation; no rollback or automatic retry after a partial PUT. */
export async function simulateTarballSequence(
	candidates: readonly Candidate[],
	identities: readonly ApprovedVersion[],
	adapter: TarballAdapter,
): Promise<"UNVERIFIABLE"> {
	validateCandidates(candidates, identities);
	for (let i = 0; i < candidates.length; i++) {
		const candidate = candidates[i];
		const approved = identities[i];
		const bytes = Buffer.from(candidate.bytes);
		const digest = createHash("sha512").update(bytes).digest("hex");
		const before = await adapter.read(candidate.name);
		const exists = inspect(before, approved);
		if (!exists) {
			if (before.rc !== undefined && before.rc !== approved.rc) throw new Error("rc tag drift");
			await adapter.publish(candidate, ["--tag", "rc", "--access", "public", "--provenance"]);
		}
		const after = await adapter.read(candidate.name);
		if (
			!inspect(after, approved) ||
			after.rc !== approved.rc ||
			after.latest !== before.latest ||
			createHash("sha512").update(candidate.bytes).digest("hex") !== digest
		)
			throw new Error("partial or changed registry write");
		const verdict = await verifyPrepackedSignedVersion(adapter.registry, adapter.proof, approved, bytes);
		if (verdict.status !== "VERIFIED_EXISTING" || verdict.sha512 !== digest)
			throw new Error("SIGNED_VERIFICATION_REQUIRED: stop before next write");
	}
	// The adapter cannot establish real OIDC permission or authorize #363 dispatch.
	return "UNVERIFIABLE";
}
