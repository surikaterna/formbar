import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ git: vi.fn(), file: vi.fn(), api: vi.fn(), source: vi.fn() }));
vi.mock("node:child_process", () => ({ execFileSync: mocks.git }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.file }));
vi.mock("../github-read", () => ({ createGitHubRead: mocks.api }));
vi.mock("../rc-source-local", () => ({ loadRcSource: mocks.source }));

import { repo } from "../live-evidence-shape";
import { refreshVerifiedRun, verifyProtectedRun } from "../rc-run-authority";
import { endpointResponses } from "./rc-workflow-fixture";

const sha = "a".repeat(40);
const tree = "b".repeat(40);

function setup(status: number) {
	vi.resetAllMocks();
	const values = endpointResponses(sha, tree, new Date());
	for (const [key, value] of Object.entries({
		GITHUB_EVENT_PATH: "/fixture/event.json",
		GITHUB_RUN_ID: "12345",
		GITHUB_RUN_ATTEMPT: "1",
		GITHUB_ACTOR: "spralle",
		GITHUB_REPOSITORY: "surikaterna/formbar",
		GITHUB_EVENT_NAME: "workflow_dispatch",
		GITHUB_REF: "refs/heads/main",
		GITHUB_REF_PROTECTED: "true",
		GITHUB_SHA: sha,
		GITHUB_WORKFLOW_SHA: sha,
		GITHUB_WORKFLOW_REF: "surikaterna/formbar/.github/workflows/release.yml@refs/heads/main",
	}))
		vi.stubEnv(key, value);
	mocks.file.mockResolvedValue(JSON.stringify({ sender: { id: 806157 }, inputs: { expected_main_sha: sha } }));
	mocks.git.mockImplementation((_cmd: string, args: string[]) =>
		args[0] === "status" ? "" : args[1] === "HEAD^{tree}" ? tree : sha,
	);
	const get = vi.fn(async (path: string) => {
		if (path.includes("/environments/") || !(path in values)) throw new Error(`HTTP ${status}`);
		return values[path];
	});
	mocks.api.mockReturnValue({ get });
	return { get, values };
}

afterEach(() => vi.unstubAllEnvs());

describe("#434 real live authority without deployment environments", () => {
	it.each([401, 403, 404])(
		"ignores unavailable environment HTTP %i at startup and per-write refresh",
		async (status) => {
			const { get } = setup(status);
			const capability = await verifyProtectedRun("/checkout", "fake-read-token");
			await expect(refreshVerifiedRun(capability)).resolves.toMatchObject({ sha, tree, runId: 12345 });
			expect(get.mock.calls.filter(([path]) => path.endsWith("/actions/runs/12345"))).toHaveLength(2);
			expect(get.mock.calls.some(([path]) => path.includes("/environments/"))).toBe(false);
		},
	);
	it.each(
		[
			`${repo}/collaborators/spralle/permission`,
			`${repo}/actions/runs/12345`,
			`${repo}/branches/main`,
			`${repo}/git/commits/${sha}`,
			`${repo}/rulesets/24103769`,
			`${repo}/rules/branches/main`,
			`${repo}/commits/${sha}/check-runs?per_page=100&page=1`,
		].flatMap((path) => [401, 403, 404].map((status) => ({ path, status }))),
	)("required endpoint $path HTTP $status still denies startup and refreshed authority", async ({ path, status }) => {
		const { values, get } = setup(status);
		const capability = await verifyProtectedRun("/checkout", "fake-read-token");
		delete values[path];
		await expect(refreshVerifiedRun(capability)).rejects.toThrow(`HTTP ${status}`);
		await expect(verifyProtectedRun("/checkout", "fake-read-token")).rejects.toThrow(`HTTP ${status}`);
		expect(get.mock.calls.some(([request]) => request.includes("/environments/"))).toBe(false);
	});
});
