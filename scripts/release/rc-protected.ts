/** Internal only. Dispatch remains rejected; this module has no workflow caller. */
import { createHash } from "node:crypto";
import { type PackageEvidence, createRegistryGitHubReader, inspectLiveRc } from "./rc-live-reads";
import { loadRcSource } from "./rc-pack-evidence";
import { type PrepackedCandidate, prepackProtectedRun, verifiedCandidateBytes } from "./rc-prepacked-candidates";
import { publishProtected, signedPublished } from "./rc-protected-providers";
import { rcPackages, rcVersion } from "./rc-reviewed-plan";
import { type VerifiedRun, claimVerifiedRun, refreshVerifiedRun, verifyProtectedRun } from "./rc-run-authority";
import type { ApprovedVersion } from "./rc-signed-existing";

type State = { run: VerifiedRun; candidates: readonly PrepackedCandidate[]; token: string };

function present(item: PackageEvidence): boolean {
	if (item.observation === "PUBLIC_EXISTING_OBSERVED") return true;
	if (
		item.observation === "UNVERIFIABLE" &&
		item.reason === "NEEDS_SIGNED_PROOF: downloaded bytes match; independent signed provenance required"
	)
		return true;
	if (item.observation === "PUBLIC_ABSENT_OBSERVED") return false;
	throw new Error("registry evidence ambiguous; new protected run required");
}

async function observe(state: State): Promise<PackageEvidence[]> {
	const source = await refreshVerifiedRun(state.run);
	const witness = loadRcSource(source.root, source.sha, source.tree);
	const bytes = new Map<string, Buffer>();
	for (const candidate of state.candidates) {
		const data = await verifiedCandidateBytes(state.run, candidate);
		if (createHash("sha512").update(data).digest("hex") !== candidate.sha512)
			throw new Error("candidate bytes changed");
		bytes.set(candidate.name.slice(9), data);
	}
	const pack = {
		pack: async (name: string) => {
			const data = bytes.get(name);
			if (!data) throw new Error("unexpected pack");
			return Buffer.from(data);
		},
	};
	const view = await inspectLiveRc(createRegistryGitHubReader("", state.token), pack, witness);
	if (view.packages.length !== rcPackages.length) throw new Error("incomplete observations");
	for (const [index, item] of view.packages.entries()) {
		const candidate = state.candidates[index];
		if (
			item.name !== candidate?.name ||
			item.local?.integrity !== candidate.integrity ||
			item.local.shasum !== candidate.shasum
		)
			throw new Error("candidate/registry drift");
		present(item);
	}
	return view.packages;
}

async function signed(state: State, candidate: PrepackedCandidate): Promise<void> {
	const source = await refreshVerifiedRun(state.run);
	const latest = loadRcSource(source.root, source.sha, source.tree).initialLatest[candidate.name.slice(9)];
	const approved: ApprovedVersion = {
		name: candidate.name,
		version: rcVersion,
		latest,
		rc: rcVersion,
		repository: "surikaterna/formbar",
		workflow: ".github/workflows/release.yml",
		ref: "refs/heads/main",
		commit: source.sha,
		runId: String(source.runId),
		attempt: "1",
	};
	await signedPublished(approved, await verifiedCandidateBytes(state.run, candidate), candidate.sha512);
}

async function reconcile(state: State, candidate: PrepackedCandidate): Promise<void> {
	// Bounded read-only propagation; a failed or uncertain PUT still stops this run.
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const items = await observe(state);
			const item = items.find((entry) => entry.name === candidate.name);
			if (!item || !present(item)) continue;
			await signed(state, candidate);
			return;
		} catch {
			// No result, including a successful read followed by failed signature, authorizes the next write.
		}
	}
	throw new Error("published version UNVERIFIABLE; stop and obtain new run/GO");
}

/** No parameters, no caller-supplied verdict/writer. Never invoked by the disabled workflow. */
export async function runProtectedRc(): Promise<{ status: "VERIFIED_SEVEN"; names: string[] }> {
	const root = process.cwd();
	const token = process.env.GITHUB_TOKEN;
	if (!token) throw new Error("GitHub read credential required");
	const run = await verifyProtectedRun(root, token);
	const candidates = await prepackProtectedRun(run);
	if (
		candidates.length !== rcPackages.length ||
		candidates.some((item, index) => item.name !== `@formbar/${rcPackages[index]}` || item.version !== rcVersion)
	)
		throw new Error("unreviewed seven-package candidate plan");
	const state: State = { run, candidates, token };
	await claimVerifiedRun(run);
	const first = await observe(state);
	for (const [index, item] of first.entries()) if (present(item)) await signed(state, candidates[index]);
	for (const candidate of candidates) {
		const items = await observe(state);
		const item = items.find((entry) => entry.name === candidate.name);
		if (!item) throw new Error("missing current package");
		if (!present(item)) {
			// Revalidate protected evidence immediately before attempting an irreversible npm subprocess.
			await refreshVerifiedRun(run);
			try {
				await publishProtected(candidate.name, await verifiedCandidateBytes(run, candidate));
			} catch {
				await reconcile(state, candidate).catch(() => {});
				throw new Error("npm publish failed or uncertain; new run/GO required");
			}
		}
		await reconcile(state, candidate);
	}
	const final = await observe(state);
	if (final.some((item) => !present(item))) throw new Error("incomplete final registry state");
	for (const candidate of candidates) await signed(state, candidate);
	return { status: "VERIFIED_SEVEN", names: candidates.map((item) => item.name) };
}
