/** #389 disabled, injected publish trace. release.yml never imports this module. */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withIsolatedSignedAudit } from "./rc-isolated-install";
import { type PackageEvidence, createRegistryGitHubReader, inspectLiveRc } from "./rc-live-reads";
import { loadRcSource } from "./rc-pack-evidence";
import { type PrepackedCandidate, verifiedCandidateBytes } from "./rc-prepacked-candidates";
import { assertPinnedPublishTools } from "./rc-publish-toolchain";
import { rcPackages, rcVersion } from "./rc-reviewed-plan";
import { type VerifiedRun, claimVerifiedRun, refreshVerifiedRun } from "./rc-run-authority";
import { type ApprovedVersion, verifyPrepackedSignedVersion } from "./rc-signed-existing";
import { createSignedRegistryReader } from "./rc-signed-reader";

export interface InjectedWriter {
	// Tests simulate package-scoped OIDC here; never return or pass an npm bearer token to this runner.
	exchange(name: string): Promise<void>;
	publish(name: string, path: string, args: readonly string[]): Promise<void>;
}
export type Trace = {
	status: "STOPPED" | "UNVERIFIABLE";
	completed: string[];
	uncertain?: string;
	reason: "PREFLIGHT" | "PUBLISH_UNCERTAIN" | "SIGNED_UNVERIFIABLE" | "INJECTED_ONLY";
};
export interface DisabledRunner {
	githubReadToken: string;
	nodeBinary: string;
	npmRoot: string;
	writer: InjectedWriter;
}

function candidatesByName(candidates: readonly PrepackedCandidate[]): Map<string, PrepackedCandidate> {
	if (candidates.length !== rcPackages.length) throw new Error("missing seven prepacked packages");
	const ordered = new Map<string, PrepackedCandidate>();
	for (const [index, name] of rcPackages.entries()) {
		const entry = candidates[index];
		if (!entry || entry.name !== `@formbar/${name}` || entry.version !== rcVersion || ordered.has(entry.name))
			throw new Error("unreviewed RC candidate set or order");
		ordered.set(entry.name, entry);
	}
	return ordered;
}

function approved(name: string, latest: string, sha: string, runId: number): ApprovedVersion {
	return {
		name,
		version: rcVersion,
		latest,
		rc: rcVersion,
		repository: "surikaterna/formbar",
		workflow: ".github/workflows/release.yml",
		ref: "refs/heads/main",
		commit: sha,
		runId: String(runId),
		attempt: "1",
	};
}

function published(item: PackageEvidence): boolean {
	if (item.observation === "PUBLIC_EXISTING_OBSERVED") return true;
	if (
		item.observation === "UNVERIFIABLE" &&
		item.reason === "NEEDS_SIGNED_PROOF: downloaded bytes match; independent signed provenance required"
	)
		return true;
	if (item.observation === "PUBLIC_ABSENT_OBSERVED") return false;
	throw new Error("public version, latest, rc, tag, release or bytes ambiguous");
}

function noNpmCredentials(): void {
	if (
		Object.entries(process.env).some(
			([key, value]) =>
				Boolean(value) &&
				(["NPM_TOKEN", "NODE_AUTH_TOKEN"].includes(key) ||
					(key.toLowerCase().startsWith("npm_config_") && /auth|password|token/i.test(key))),
		)
	)
		throw new Error("ambient npm credential fallback forbidden");
}

async function observe(run: VerifiedRun, candidates: Map<string, PrepackedCandidate>, githubToken: string) {
	const source = await refreshVerifiedRun(run);
	const witness = loadRcSource(source.root, source.sha, source.tree);
	const bytes = new Map<string, Buffer>();
	for (const name of rcPackages) {
		const packageName = `@formbar/${name}`;
		const candidate = candidates.get(packageName);
		if (!candidate) throw new Error("missing candidate");
		const value = await verifiedCandidateBytes(run, candidate);
		if (
			createHash("sha512").update(value).digest("hex") !== candidate.sha512 ||
			createHash("sha1").update(value).digest("hex") !== candidate.shasum
		)
			throw new Error("prepacked bytes changed");
		bytes.set(name, value);
	}
	const pack = {
		pack: async (name: string) => {
			const data = bytes.get(name);
			if (!data) throw new Error("foreign pack");
			return Buffer.from(data);
		},
	};
	const view = await inspectLiveRc(createRegistryGitHubReader("", githubToken), pack, witness);
	if (view.packages.length !== rcPackages.length) throw new Error("incomplete public observations");
	for (const [index, item] of view.packages.entries()) {
		if (
			item.name !== `@formbar/${rcPackages[index]}` ||
			!item.local ||
			item.local.integrity !== candidates.get(item.name)?.integrity ||
			item.local.shasum !== candidates.get(item.name)?.shasum
		)
			throw new Error("changed prepacked candidate");
		published(item);
	}
	return { source, view };
}

async function signed(run: VerifiedRun, candidate: PrepackedCandidate, settings: DisabledRunner): Promise<boolean> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const source = await refreshVerifiedRun(run);
			const expected = await verifiedCandidateBytes(run, candidate);
			const latest = loadRcSource(source.root, source.sha, source.tree).initialLatest[candidate.name.slice(9)];
			const verdict = await withIsolatedSignedAudit(
				candidate.name,
				rcVersion,
				settings.nodeBinary,
				settings.npmRoot,
				(proof) =>
					verifyPrepackedSignedVersion(
						createSignedRegistryReader(),
						proof,
						approved(candidate.name, latest, source.sha, source.runId),
						expected,
					),
			);
			if (verdict.status === "VERIFIED_EXISTING" && verdict.sha512 === candidate.sha512) return true;
		} catch {
			/* Missing installation, attestation or fresh GO cannot advance to another write. */
		}
	}
	return false;
}

async function publish(candidate: PrepackedCandidate, run: VerifiedRun, writer: InjectedWriter): Promise<void> {
	const bytes = await verifiedCandidateBytes(run, candidate);
	if (createHash("sha512").update(bytes).digest("hex") !== candidate.sha512)
		throw new Error("prepacked bytes changed before publish");
	const directory = await mkdtemp(join(tmpdir(), "formbar-rc-tarball-"));
	const tarball = join(directory, `${candidate.name.slice(9)}-${candidate.version}.tgz`);
	try {
		await writeFile(tarball, bytes, { flag: "wx" });
		await refreshVerifiedRun(run);
		if (!Buffer.from(await readFile(tarball)).equals(bytes)) throw new Error("tampered prepacked tarball");
		await writer.publish(candidate.name, tarball, [
			"publish",
			tarball,
			"--tag",
			"rc",
			"--access",
			"public",
			"--provenance",
			"--registry=https://registry.npmjs.org/",
			"--userconfig=/dev/null",
			"--globalconfig=/dev/null",
		]);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

/** Never a release verdict: injected writers and fake tests cannot establish npm permission or atomicity. */
export async function traceDisabledRc(
	run: VerifiedRun,
	candidates: readonly PrepackedCandidate[],
	settings: DisabledRunner,
): Promise<Trace> {
	const completed: string[] = [];
	let uncertain: string | undefined;
	try {
		await claimVerifiedRun(run);
		const ordered = candidatesByName(candidates);
		const initial = await observe(run, ordered, settings.githubReadToken);
		for (const item of initial.view.packages) {
			const candidate = ordered.get(item.name);
			if (!candidate || (published(item) && !(await signed(run, candidate, settings))))
				throw new Error("existing version lacks signed run proof");
		}
		for (const candidate of ordered.values()) {
			const current = await observe(run, ordered, settings.githubReadToken);
			const item = current.view.packages.find((entry) => entry.name === candidate.name);
			if (!item) throw new Error("missing current public read");
			const exists = published(item);
			let publishFailed = false;
			if (!exists) {
				uncertain = candidate.name;
				try {
					noNpmCredentials();
					await assertPinnedPublishTools(settings.nodeBinary, settings.npmRoot);
					await settings.writer.exchange(candidate.name);
					const afterExchange = await observe(run, ordered, settings.githubReadToken);
					const fresh = afterExchange.view.packages.find((entry) => entry.name === candidate.name);
					if (!fresh || published(fresh)) throw new Error("changed absence after exchange");
					await publish(candidate, run, settings.writer);
				} catch {
					publishFailed = true;
				}
			}
			if (!(await signed(run, candidate, settings)))
				return { status: "STOPPED", completed, ...(uncertain ? { uncertain } : {}), reason: "SIGNED_UNVERIFIABLE" };
			completed.push(candidate.name);
			if (publishFailed) return { status: "STOPPED", completed, uncertain, reason: "PUBLISH_UNCERTAIN" };
			uncertain = undefined;
		}
		const final = await observe(run, ordered, settings.githubReadToken);
		if (final.view.packages.some((entry) => !published(entry))) throw new Error("final registry changed");
		return { status: "UNVERIFIABLE", completed, reason: "INJECTED_ONLY" };
	} catch {
		return { status: "STOPPED", completed, ...(uncertain ? { uncertain } : {}), reason: "PREFLIGHT" };
	}
}
