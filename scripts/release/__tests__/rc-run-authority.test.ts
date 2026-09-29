import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	git: vi.fn(),
	file: vi.fn(),
	api: vi.fn(),
	read: vi.fn(),
	source: vi.fn(),
}));
vi.mock("node:child_process", () => ({ execFileSync: mocks.git }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.file }));
vi.mock("../github-read", () => ({ createGitHubRead: mocks.api }));
vi.mock("../live-evidence", () => ({ fetchRcEvidence: mocks.read }));
vi.mock("../rc-source-local", () => ({ loadRcSource: mocks.source }));

import { refreshVerifiedRun, verifyProtectedRun } from "../rc-run-authority";

const commit = "a".repeat(40);
const tree = "b".repeat(40);
const environment = {
	GITHUB_EVENT_PATH: "/generated/event.json",
	GITHUB_RUN_ID: "12345",
	GITHUB_RUN_ATTEMPT: "1",
	GITHUB_ACTOR: "spralle",
	GITHUB_REPOSITORY: "surikaterna/formbar",
	GITHUB_EVENT_NAME: "workflow_dispatch",
	GITHUB_REF: "refs/heads/main",
	GITHUB_WORKFLOW_REF: "surikaterna/formbar/.github/workflows/release.yml@refs/heads/main",
	GITHUB_WORKFLOW_SHA: commit,
	GITHUB_SHA: commit,
};

function setup() {
	vi.resetAllMocks();
	for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
	mocks.file.mockResolvedValue(JSON.stringify({ sender: { id: 806157 }, inputs: { expected_main_sha: commit } }));
	mocks.git.mockImplementation((_cmd: string, args: string[]) => {
		if (args[0] === "status") return "";
		return args[1] === "HEAD^{tree}" ? tree : commit;
	});
	mocks.api.mockReturnValue({ get: vi.fn() });
}

afterEach(() => vi.unstubAllEnvs());

describe("#389 private verified run", () => {
	it("denies a raw caller object, without fetching or writing anything", async () => {
		setup();
		await expect(refreshVerifiedRun({ approved: true, sha: commit })).rejects.toThrow("capability");
		expect(mocks.read).not.toHaveBeenCalled();
	});
	it("binds runtime event, checked-out source and real reader boundary; rechecks on reuse", async () => {
		setup();
		const capability = await verifyProtectedRun("/checkout", "read-only-gh-token");
		expect(mocks.source).toHaveBeenCalledWith("/checkout", commit, tree);
		expect(mocks.api).toHaveBeenCalledWith("read-only-gh-token");
		expect(mocks.read).toHaveBeenCalledWith(
			{ get: expect.any(Function) },
			expect.objectContaining({ runId: 12345, checkoutSha: commit, checkoutTree: tree, senderId: 806157 }),
		);
		expect(await refreshVerifiedRun(capability)).toEqual({ root: "/checkout", sha: commit, tree, runId: 12345 });
		expect(mocks.read).toHaveBeenCalledTimes(2);
		mocks.read.mockRejectedValueOnce(new Error("policy changed"));
		await expect(refreshVerifiedRun(capability)).rejects.toThrow("policy changed");
	});
	it.each(["missing-event", "wrong-sha", "dirty", "no-policy", "missing-plan", "new-run"])(
		"refuses %s before or during minting",
		async (failure) => {
			setup();
			if (failure === "missing-event") vi.stubEnv("GITHUB_EVENT_PATH", "");
			if (failure === "wrong-sha")
				mocks.file.mockResolvedValue(JSON.stringify({ sender: { id: 806157 }, inputs: { expected_main_sha: tree } }));
			if (failure === "dirty")
				mocks.git.mockImplementation((_cmd: string, args: string[]) =>
					args[0] === "status" ? " M packages/core/package.json" : args[1] === "HEAD^{tree}" ? tree : commit,
				);
			if (failure === "no-policy") mocks.read.mockRejectedValue(new Error("#406 denies policy"));
			if (failure === "missing-plan")
				mocks.source.mockImplementation(() => {
					throw new Error("#383 prerelease missing");
				});
			if (failure === "new-run") vi.stubEnv("GITHUB_RUN_ID", "NaN");
			await expect(verifyProtectedRun("/checkout", "read-only-gh-token")).rejects.toThrow();
		},
	);
	it("rejects run/checkout drift on refresh rather than replaying the capability", async () => {
		setup();
		const capability = await verifyProtectedRun("/checkout", "read-only-gh-token");
		vi.stubEnv("GITHUB_RUN_ID", "12346");
		await expect(refreshVerifiedRun(capability)).rejects.toThrow("new run required");
	});
});
