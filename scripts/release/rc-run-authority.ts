/** Disabled #389: only authenticated live reads can mint this private, run-bound capability. */
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createGitHubRead } from "./github-read";
import { type RunWitness, fetchRcEvidence } from "./live-evidence";
import { loadRcSource } from "./rc-pack-evidence";

declare const brand: unique symbol;
export type VerifiedRun = { readonly [brand]: true };
type Binding = { root: string; token: string; runId: number; sha: string; tree: string };
const bindings = new WeakMap<object, Binding>();
const claimedRuns = new Set<string>();
const sha = /^[0-9a-f]{40}$/;

function git(root: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8", timeout: 10_000, maxBuffer: 100_000 }).trim();
}

function checkout(root: string): { sha: string; tree: string } {
	const commit = git(root, "rev-parse", "HEAD");
	const tree = git(root, "rev-parse", "HEAD^{tree}");
	if (!sha.test(commit) || !sha.test(tree) || git(root, "status", "--porcelain") !== "")
		throw new Error("RC checkout is not clean and pinned");
	return { sha: commit, tree };
}

async function witness(root: string): Promise<RunWitness> {
	const env = process.env;
	if (!env.GITHUB_EVENT_PATH) throw new Error("GitHub-generated event path missing");
	const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, "utf8")) as {
		sender?: { id?: number };
		inputs?: { expected_main_sha?: string };
	};
	const source = checkout(root);
	const runId = Number(env.GITHUB_RUN_ID);
	if (
		!Number.isSafeInteger(runId) ||
		runId <= 0 ||
		!sha.test(event.inputs?.expected_main_sha ?? "") ||
		event.inputs?.expected_main_sha !== source.sha
	)
		throw new Error("run ID or expected_main_sha differs from checkout");
	return {
		runId,
		attempt: Number(env.GITHUB_RUN_ATTEMPT),
		actor: env.GITHUB_ACTOR ?? "",
		senderId: event.sender?.id ?? -1,
		repository: env.GITHUB_REPOSITORY ?? "",
		event: env.GITHUB_EVENT_NAME ?? "",
		ref: env.GITHUB_REF ?? "",
		workflowRef: env.GITHUB_WORKFLOW_REF ?? "",
		workflowSha: env.GITHUB_WORKFLOW_SHA ?? "",
		eventSha: env.GITHUB_SHA ?? "",
		checkoutSha: source.sha,
		checkoutTree: source.tree,
		expectedSha: source.sha,
	};
}

async function validate(root: string, token: string): Promise<RunWitness> {
	const run = await witness(root);
	// #383 validates all seven manifests, exact 23 consumed IDs, changelogs and stable baselines.
	loadRcSource(root, run.expectedSha, run.checkoutTree);
	await fetchRcEvidence(createGitHubRead(token), run, new Date());
	const again = await witness(root);
	if (JSON.stringify(run) !== JSON.stringify(again)) throw new Error("RC checkout or run changed during validation");
	return run;
}

/** There is no caller-provided approved flag or test-positive publish path. */
export async function verifyProtectedRun(root: string, githubReadToken: string): Promise<VerifiedRun> {
	const run = await validate(root, githubReadToken);
	const authority = Object.freeze({}) as VerifiedRun;
	bindings.set(authority, {
		root,
		token: githubReadToken,
		runId: run.runId,
		sha: run.expectedSha,
		tree: run.checkoutTree,
	});
	return authority;
}

/** Revalidate before a future write; callers cannot forge a capability by copying its shape. */
export async function refreshVerifiedRun(
	value: unknown,
): Promise<{ root: string; sha: string; tree: string; runId: number }> {
	const bound = value && typeof value === "object" ? bindings.get(value) : undefined;
	if (!bound) throw new Error("missing private verified-run capability");
	const run = await validate(bound.root, bound.token);
	if (run.expectedSha !== bound.sha || run.checkoutTree !== bound.tree || run.runId !== bound.runId)
		throw new Error("protected run changed; new GO required");
	return { root: bound.root, sha: bound.sha, tree: bound.tree, runId: bound.runId };
}

/** An attempted sequence consumes this exact run even if no PUT was acknowledged. */
export async function claimVerifiedRun(value: unknown): ReturnType<typeof refreshVerifiedRun> {
	const source = await refreshVerifiedRun(value);
	const key = `${source.runId}/${source.sha}`;
	if (claimedRuns.has(key)) throw new Error("run already attempted; new protected run and FINAL GO required");
	claimedRuns.add(key);
	return source;
}
