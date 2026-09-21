import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parse } from "yaml";

const execute = promisify(execFile);

export const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
export const expectedSha = "cce4eccf52738e5d2666c3fb734b2e76f531d514";

export const workflowCases = [
	{ file: "ci.yml", job: "ci", name: "CI" },
	{ file: "release.yml", job: "publish", name: "Publish" },
	{ file: "pages.yml", job: "build", name: "Deploy to GitHub Pages" },
] as const;

export type WorkflowStep = {
	env?: Record<string, string>;
	if?: string;
	name?: string;
	run?: string;
	shell?: string;
	uses?: string;
	with?: Record<string, unknown>;
};

export type Workflow = {
	concurrency?: unknown;
	jobs: Record<string, { if?: string; steps: WorkflowStep[] }>;
	name: string;
	on: Record<string, unknown>;
	permissions: Record<string, string>;
};

export async function loadWorkflow(file: string): Promise<Workflow> {
	const source = await readFile(join(repositoryRoot, ".github", "workflows", file), "utf8");
	return parse(source) as Workflow;
}

export async function loadWorkflowSource(file: string): Promise<string> {
	return readFile(join(repositoryRoot, ".github", "workflows", file), "utf8");
}

export function guardStep(workflow: Workflow, job: string): WorkflowStep {
	const step = workflow.jobs[job]?.steps[0];
	if (!step) throw new Error(`Missing first step for ${job}`);
	return step;
}

type GuardScenario = {
	api?: Partial<typeof defaultApi> & { failEndpoint?: string };
	env?: Record<string, string>;
};

const defaultApi = {
	defaultBranch: "main",
	issueIsPr: "false",
	issueState: "open",
	mainProtected: "true",
	mainSha: expectedSha,
};

function guardEnvironment(file: string, scenario: GuardScenario): NodeJS.ProcessEnv {
	return {
		...process.env,
		EXPECTED_MAIN_SHA: expectedSha,
		EXPECTED_WORKFLOW_REF: `surikaterna/formbar/.github/workflows/${file}@refs/heads/main`,
		FAKE_DEFAULT_BRANCH: scenario.api?.defaultBranch ?? defaultApi.defaultBranch,
		FAKE_FAIL_ENDPOINT: scenario.api?.failEndpoint ?? "",
		FAKE_ISSUE_IS_PR: scenario.api?.issueIsPr ?? defaultApi.issueIsPr,
		FAKE_ISSUE_STATE: scenario.api?.issueState ?? defaultApi.issueState,
		FAKE_MAIN_PROTECTED: scenario.api?.mainProtected ?? defaultApi.mainProtected,
		FAKE_MAIN_SHA: scenario.api?.mainSha ?? defaultApi.mainSha,
		GH_TOKEN: "fixture-token",
		GITHUB_REF: "refs/heads/main",
		GITHUB_REF_PROTECTED: "true",
		GITHUB_REPOSITORY: "surikaterna/formbar",
		GITHUB_SHA: expectedSha,
		GITHUB_WORKFLOW_REF: `surikaterna/formbar/.github/workflows/${file}@refs/heads/main`,
		GITHUB_WORKFLOW_SHA: expectedSha,
		RECOVERY_ISSUE: "103",
		...scenario.env,
	};
}

const fakeGh = `#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == "api" ]]
endpoint="$2"
query="$4"
[[ "$endpoint" != "$FAKE_FAIL_ENDPOINT" ]]
case "$endpoint|$query" in
  "repos/surikaterna/formbar|.default_branch") printf '%s\\n' "$FAKE_DEFAULT_BRANCH" ;;
  "repos/surikaterna/formbar/branches/main|.protected") printf '%s\\n' "$FAKE_MAIN_PROTECTED" ;;
  "repos/surikaterna/formbar/git/ref/heads/main|.object.sha") printf '%s\\n' "$FAKE_MAIN_SHA" ;;
  "repos/surikaterna/formbar/issues/103|.state") printf '%s\\n' "$FAKE_ISSUE_STATE" ;;
  "repos/surikaterna/formbar/issues/103|has(\\\"pull_request\\\")") printf '%s\\n' "$FAKE_ISSUE_IS_PR" ;;
  *) exit 64 ;;
esac
`;

export async function runGuard(file: string, script: string, scenario: GuardScenario = {}) {
	const root = await mkdtemp(join(tmpdir(), "workflow-guard-"));
	const ghPath = join(root, "gh");
	try {
		await writeFile(ghPath, fakeGh);
		await chmod(ghPath, 0o755);
		const env = guardEnvironment(file, scenario);
		env.PATH = `${root}:${env.PATH ?? ""}`;
		return await execute("bash", ["-e", "-o", "pipefail", "-c", script], { env });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

export function expectedWorkflowRef(file: string): string {
	return `surikaterna/formbar/.github/workflows/${basename(file)}@refs/heads/main`;
}
