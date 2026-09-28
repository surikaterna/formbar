import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatchContext } from "../guard";
import {
	type GoEvidence,
	type ReviewContract,
	type ReviewedSource,
	consumed,
	inspectRcSource,
} from "../rc-source-check";
import type { ReleasePlan, ReleaseReader } from "../types";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
const sha = "a".repeat(40);
const tree = "b".repeat(40);
const head = "403995aefdb6ae8faaf990eef95f32c03b2debce";
const base = "ed949ab79f34cea6c205969b0d3e6bd038060721";
const names = ["arbiter", "core", "declarative", "from-schema", "react", "react-schema"];
const context: DispatchContext = {
	event: "workflow_dispatch",
	repository: "surikaterna/formbar",
	ref: "refs/heads/main",
	workflowRef: "surikaterna/formbar/.github/workflows/release.yml@refs/heads/main",
	workflowSha: sha,
	eventSha: sha,
	checkoutSha: sha,
	liveMainSha: sha,
	expectedSha: sha,
};
const source: ReviewedSource = {
	base,
	head,
	observedBase: base,
	observedHead: head,
	versionTree: tree,
	observedVersionTree: tree,
	mainTree: tree,
	reviewedMainTree: tree,
};
const go: GoEvidence = {
	repository: context.repository,
	issue: 250,
	commentId: 123,
	runId: 42,
	runAttempt: 1,
	runCreatedAt: "2026-09-27T09:59:59Z",
	author: "spralle",
	signer: "spralle",
	createdAt: "2026-09-27T10:00:00Z",
	updatedAt: "2026-09-27T10:00:00Z",
	expiresAt: "2026-09-28T10:00:00Z",
	checkedAt: "2026-09-27T11:00:00Z",
	commit: sha,
	tree,
	base,
	head,
	acknowledgesLegacyIssueMigration: true,
	versions: names.map((name) => `@formbar/${name}@0.23.0-rc.0`),
	distTag: "rc",
	provenance: true,
};
const review: ReviewContract = {
	environment: "formbar-rc",
	protectedMain: true,
	noBypass: true,
	protectedBranchesOnly: true,
	preventSelfReview: true,
	runId: 42,
	approvedRunId: 42,
	dispatcher: "eaglez",
	reviewer: "spralle",
	goSigner: "spralle",
	runAttempt: 1,
};
const plan: ReleasePlan = {
	schemaVersion: 1,
	repository: context.repository,
	releaseCommit: sha,
	candidates: names.map((name) => ({
		name: `@formbar/${name}`,
		version: "0.23.0-rc.0",
		directory: `packages/${name}`,
		tag: `@formbar/${name}@0.23.0-rc.0`,
		notes: "notes",
		prerelease: true,
		releaseCommit: sha,
		tagAction: "create",
		releaseAction: "create",
	})),
};
const reader: ReleaseReader = {
	npmVersion: vi.fn(async () => ({ exists: false })),
	tag: vi.fn(async () => ({ kind: "absent" })),
	release: vi.fn(async () => ({ kind: "absent" })),
};
const files = readFile as ReturnType<typeof vi.fn>;

describe("disabled RC source inspection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		files.mockReset();
	});
	it.each([
		[{ context: { event: "push" } }, "dispatch"],
		[{ source: { observedHead: sha } }, "#298"],
		[{ source: { base: sha, observedBase: sha } }, "#298"],
		[{ source: { reviewedMainTree: sha } }, "tree"],
		[{ go: { issue: 362 } }, "GO"],
		[{ go: { runId: 41 } }, "approval"],
		[{ go: { runAttempt: 2 } }, "GO"],
		[{ go: { runCreatedAt: go.createdAt } }, "GO"],
		[{ go: { runCreatedAt: "not-a-date" } }, "GO"],
		[{ go: { author: "stranger" } }, "GO"],
		[{ go: { updatedAt: "2026-09-27T10:01:00Z" } }, "GO"],
		[{ go: { checkedAt: "2026-09-28T10:00:00Z" } }, "GO"],
		[{ go: { commit: head } }, "GO"],
		[{ go: { tree: sha } }, "GO"],
		[{ go: { acknowledgesLegacyIssueMigration: false } }, "GO"],
		[{ go: { distTag: "latest" } }, "GO"],
		[{ review: { reviewer: "eaglez" } }, "approval"],
		[{ review: { reviewer: "stranger" } }, "approval"],
		[{ review: { dispatcher: "spralle" } }, "approval"],
		[{ review: { runAttempt: 2 } }, "approval"],
		[{ review: { protectedMain: false } }, "approval"],
		[{ review: { noBypass: false } }, "approval"],
		[{ review: { environment: "unprotected" } }, "approval"],
		[{ review: { approvedRunId: 41 } }, "approval"],
	] as const)("rejects bad evidence %# without writes", async (change, message) => {
		const selected = { ...source, ...change.source };
		await expect(
			inspectRcSource(
				"/mock",
				{ ...context, ...change.context },
				plan,
				reader,
				selected,
				{ ...go, ...change.go },
				{ ...review, ...change.review },
			),
		).rejects.toThrow(message);
		expect(files).not.toHaveBeenCalled();
	});

	it("rejects edited pre.json and source drift without writes", async () => {
		files.mockResolvedValue(JSON.stringify({ mode: "exit", tag: "rc", changesets: [] }));
		await expect(inspectRcSource("/mock", context, plan, reader, source, go, review)).rejects.toThrow("prerelease");
		expect(reader.tag).not.toHaveBeenCalled();
	});

	it("rejects registry collisions and all tag/release conflicts before any write", async () => {
		files.mockImplementation(async (path: string) => {
			if (path.endsWith("pre.json"))
				return JSON.stringify({
					mode: "pre",
					tag: "rc",
					initialVersions: { "@formbar/expressions": "0.14.3" },
					changesets: consumed,
				});
			if (path.endsWith("CHANGELOG.md")) return "## 0.23.0-rc.0\n\nnotes";
			const name = path.split("/").at(-2);
			return JSON.stringify({ name: `@formbar/${name}`, version: name === "expressions" ? "0.14.3" : "0.23.0-rc.0" });
		});
		await expect(
			inspectRcSource(
				"/mock",
				context,
				plan,
				{
					...reader,
					npmVersion: async () => ({ exists: true }),
				},
				source,
				go,
				review,
			),
		).rejects.toThrow("missing registry gitHead");
		await expect(
			inspectRcSource(
				"/mock",
				context,
				plan,
				{
					...reader,
					tag: async () => ({ kind: "lightweight", target: sha }),
				},
				source,
				go,
				review,
			),
		).rejects.toThrow("lightweight");
		await expect(
			inspectRcSource(
				"/mock",
				context,
				plan,
				{ ...reader, release: async () => ({ kind: "draft", name: "bad", body: "", prerelease: true }) },
				source,
				go,
				review,
			),
		).rejects.toThrow("draft");
		await expect(inspectRcSource("/mock", context, plan, reader, source, go, review)).resolves.toBeUndefined();
		await expect(
			inspectRcSource(
				"/mock",
				context,
				plan,
				{ ...reader, npmVersion: async () => ({ exists: true, gitHead: sha }) },
				source,
				go,
				review,
			),
		).resolves.toBeUndefined();
		files.mockImplementation(async (path: string) => {
			if (path.endsWith("pre.json")) return JSON.stringify({ mode: "pre", tag: "rc", changesets: [] });
			return "";
		});
		await expect(inspectRcSource("/mock", context, plan, reader, source, go, review)).rejects.toThrow("consumed IDs");
	});
});
