/** Read-only dispatch checkpoint; never grants a publish capability. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHubRead } from "./github-read";
import { type RunWitness, fetchRcEvidence, verifyWitness } from "./live-evidence";
import { loadRcSource } from "./rc-pack-evidence";

type Runtime = Record<string, string | undefined>;
type Checkout = { sha: string; tree: string; clean: boolean };

function jsonObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid dispatch event");
	return value as Record<string, unknown>;
}

export function dispatchWitness(env: Runtime, event: unknown, checkout: Checkout): RunWitness {
	const payload = jsonObject(event);
	const sender = jsonObject(payload.sender);
	const runId = Number(env.GITHUB_RUN_ID);
	const attempt = Number(env.GITHUB_RUN_ATTEMPT);
	if (
		!checkout.clean ||
		!/^\d+$/.test(env.GITHUB_RUN_ID ?? "") ||
		!/^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? "") ||
		!Number.isSafeInteger(runId) ||
		!Number.isSafeInteger(attempt) ||
		!env.GITHUB_EVENT_PATH ||
		!env.GITHUB_TOKEN ||
		!env.GITHUB_WORKFLOW_SHA ||
		!env.GITHUB_WORKFLOW_REF ||
		!env.GITHUB_SHA ||
		!env.EXPECTED_MAIN_SHA
	)
		throw new Error("Incomplete protected dispatch context");
	return {
		runId,
		attempt,
		actor: env.GITHUB_ACTOR ?? "",
		senderId: sender.id as number,
		repository: env.GITHUB_REPOSITORY ?? "",
		event: env.GITHUB_EVENT_NAME ?? "",
		ref: env.GITHUB_REF ?? "",
		workflowRef: env.GITHUB_WORKFLOW_REF,
		workflowSha: env.GITHUB_WORKFLOW_SHA,
		eventSha: env.GITHUB_SHA,
		checkoutSha: checkout.sha,
		checkoutTree: checkout.tree,
		expectedSha: env.EXPECTED_MAIN_SHA,
	};
}

export async function inspectDispatch(
	root: string,
	env: Runtime,
	event: unknown,
	checkout: Checkout,
	read: typeof fetchRcEvidence,
	now: Date,
	readSource: (root: string, sha: string, tree: string) => unknown = loadRcSource,
): Promise<void> {
	const witness = dispatchWitness(env, event, checkout);
	verifyWitness(witness);
	// Local source must be versioned before any remote evidence can authorize this run.
	readSource(root, witness.expectedSha, witness.checkoutTree);
	await read(createGitHubRead(env.GITHUB_TOKEN ?? ""), witness, now);
}

function git(root: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function main(): Promise<void> {
	const root = resolve(".");
	const env = process.env;
	if (!env.GITHUB_EVENT_PATH) throw new Error("Missing dispatch event");
	const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
	const checkout = {
		sha: git(root, "rev-parse", "HEAD"),
		tree: git(root, "rev-parse", "HEAD^{tree}"),
		clean: git(root, "status", "--porcelain") === "",
	};
	await inspectDispatch(root, env, event, checkout, fetchRcEvidence, new Date());
	console.log("#363 read-only dispatch checkpoint passed; publishing remains disabled");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch(() => {
		console.error("#363 RC dispatch denied; no release authority");
		process.exitCode = 1;
	});
}
