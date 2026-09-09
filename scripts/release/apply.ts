import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LiveServices } from "./adapters";
import { isPrerelease } from "./changelog";
import { awaitFinalReleases, preflightAll } from "./preflight";
import type { Wait } from "./preflight";
import type { Candidate, ReleasePlan, ReleaseReader, ReleaseWriter } from "./types";
import { parseReleasePlan } from "./validation";

const delay: Wait = (milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function validatePlan(plan: ReleasePlan, repository: string, releaseCommit: string): void {
	if (plan.schemaVersion !== 1 || plan.repository !== repository || plan.releaseCommit !== releaseCommit) {
		throw new Error("Release plan does not match this repository and commit");
	}
	if (plan.candidates.some((candidate) => candidate.version === "0.2.1")) {
		throw new Error("Refusing prohibited historical version 0.2.1");
	}
	const tags = new Set<string>();
	for (const candidate of plan.candidates) {
		if (!candidate.name.startsWith("@") || candidate.tag !== `${candidate.name}@${candidate.version}`) {
			throw new Error("Release plan contains an invalid scoped package tag");
		}
		if (candidate.releaseCommit !== releaseCommit || candidate.prerelease !== isPrerelease(candidate.version)) {
			throw new Error("Release plan contains inconsistent candidate metadata");
		}
		if (!candidate.notes.trim() || tags.has(candidate.tag)) throw new Error("Release plan contains invalid candidates");
		tags.add(candidate.tag);
	}
}

async function awaitNpm(candidate: Candidate, reader: ReleaseReader, attempts: number, wait: Wait): Promise<void> {
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const npm = await reader.npmVersion(candidate.name, candidate.version);
		if (npm.exists && npm.gitHead === candidate.releaseCommit) return;
		if (npm.exists && npm.gitHead && npm.gitHead !== candidate.releaseCommit) {
			throw new Error(`${candidate.tag} was published from conflicting gitHead ${npm.gitHead}`);
		}
		if (attempt < attempts) await wait(2 ** (attempt - 1) * 1_000);
	}
	throw new Error(`${candidate.tag} did not propagate to npm with the release gitHead`);
}

export async function applyPlan(
	plan: ReleasePlan,
	reader: ReleaseReader,
	writer: ReleaseWriter,
	options: { dryRun?: boolean; attempts?: number; wait?: Wait } = {},
): Promise<void> {
	for (const candidate of plan.candidates) {
		await awaitNpm(candidate, reader, options.attempts ?? 6, options.wait ?? delay);
	}
	const candidates = await preflightAll(plan.candidates, reader);
	if (options.dryRun) return;

	const missingTags = candidates.filter((candidate) => candidate.tagAction === "create");
	await Promise.all(missingTags.map((candidate) => writer.preflightLocalTag(candidate)));
	for (const candidate of missingTags) await writer.createLocalTag(candidate);
	await writer.pushTagsAtomically(missingTags.map((candidate) => candidate.tag));
	const tagReader: ReleaseReader = {
		npmVersion: (name, version) => reader.npmVersion(name, version),
		tag: (tag) => reader.tag(tag),
		release: async () => ({ kind: "absent" }),
	};
	await preflightAll(
		candidates.map((candidate) => ({ ...candidate, tagAction: "none" })),
		tagReader,
	);

	for (const candidate of candidates) {
		if (candidate.releaseAction === "create") await writer.createRelease(candidate);
	}
	const final = await preflightAll(candidates, reader);
	if (final.some((candidate) => candidate.tagAction !== "none")) {
		throw new Error("Final release artifact verification failed");
	}
	await awaitFinalReleases(final, reader, options.wait ?? delay);
}

async function main(): Promise<void> {
	const path = process.env.RELEASE_PLAN;
	if (!path) throw new Error("RELEASE_PLAN is required");
	let decoded: unknown;
	try {
		decoded = JSON.parse(await readFile(path, "utf8"));
	} catch {
		throw new Error("Release plan is not valid JSON");
	}
	const plan = parseReleasePlan(decoded);
	const repository = process.env.GITHUB_REPOSITORY ?? "";
	const releaseCommit = process.env.GITHUB_SHA ?? "";
	validatePlan(plan, repository, releaseCommit);
	const services = new LiveServices(repository);
	await applyPlan(plan, services, services, { dryRun: process.argv.includes("--dry-run") });
	console.log(`Release reconciliation complete: ${plan.candidates.length} candidate(s)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
