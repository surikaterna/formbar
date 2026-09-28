import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DispatchContext } from "../guard";
import type { ReadOnlyTransport } from "../rc-live-reads";
import { initialVersions, rcEdges, rcPackages } from "../rc-reviewed-plan";
import {
	type GoEvidence,
	type ReviewContract,
	type ReviewedSource,
	consumed,
	inspectRcSource,
} from "../rc-source-check";
import type { GithubReleaseState, ReleasePlan, ReleaseReader, TagState } from "../types";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
vi.mock("../rc-reviewed-plan", async (original) => ({ ...(await original()), checkChangelog: vi.fn() }));
const sha = "a".repeat(40);
const tree = "b".repeat(40);
const head = "c".repeat(40);
const base = "d".repeat(40);
const names = rcPackages;
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
	mergeCommit: sha,
	changedFiles: [{ filename: ".changeset/pre.json", sha: "e".repeat(40), status: "modified" }],
	consentCommentId: 1234,
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
	mergeCommit: sha,
	acknowledgesLegacyIssueMigration: true,
	versions: names.map((name) => `@formbar/${name}@0.23.0-rc.0`),
	ranges: Object.fromEntries(
		names.map((name) => [
			`@formbar/${name}`,
			Object.fromEntries(rcEdges[name].map((edge) => [`@formbar/${edge}`, "^0.23.0-rc.0"])),
		]),
	),
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
	tag: vi.fn(async (): Promise<TagState> => ({ kind: "absent" })),
	release: vi.fn(async (): Promise<GithubReleaseState> => ({ kind: "absent" })),
};
const files = readFile as ReturnType<typeof vi.fn>;
const api = "https://api.github.com/repos/surikaterna/formbar";
const live: ReadOnlyTransport = {
	async get(url) {
		const data: Record<string, unknown> = {
			[`${api}/pulls/298`]: {
				head: { sha: head },
				base: { sha: base },
				merged: true,
				state: "closed",
				merge_commit_sha: sha,
				merged_at: "2026-09-27T09:00:00Z",
				changed_files: 1,
			},
			[`${api}/git/commits/${head}`]: { tree: { sha: tree } },
			[`${api}/pulls/298/files?per_page=100`]: source.changedFiles,
			[`${api}/issues/comments/1234`]: {
				id: 1234,
				user: { login: "spralle", id: 806157 },
				issue_url: `${api}/issues/298`,
				created_at: "2026-09-27T08:00:00Z",
				updated_at: "2026-09-27T08:00:00Z",
				body: JSON.stringify({ base, head, tree, files: source.changedFiles }),
			},
			[`${api}/commits/${sha}`]: { parents: [{ sha: base }, { sha: head }], commit: { tree: { sha: tree } } },
			[`${api}/commits/main`]: { sha, commit: { tree: { sha: tree } } },
			[`${api}/issues/comments/123`]: {
				id: 123,
				issue_url: `${api}/issues/250`,
				user: { login: "spralle", id: 806157 },
				created_at: go.createdAt,
				updated_at: go.updatedAt,
				body: `FINAL GO\n${JSON.stringify(go)}`,
			},
			[`${api}/actions/runs/42/attempts/1`]: {
				id: 42,
				run_attempt: 1,
				created_at: go.runCreatedAt,
				head_sha: sha,
				head_branch: "main",
			},
		};
		return { status: url in data ? 200 : 404, body: data[url] };
	},
};

type EvidenceChange = {
	context?: Partial<DispatchContext>;
	source?: Partial<ReviewedSource>;
	go?: Partial<GoEvidence>;
	review?: Partial<ReviewContract>;
};

const invalidEvidence: ReadonlyArray<readonly [EvidenceChange, string]> = [
	[{ context: { event: "push" } }, "dispatch"],
	[{ source: { observedHead: sha } }, "#298"],
	[{ source: { base: sha, observedBase: sha } }, "GO"],
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
	[{ go: { ranges: { ...go.ranges, "@formbar/core": { "@formbar/expressions": "^0.14.3" } } } }, "GO"],
	[{ review: { reviewer: "eaglez" } }, "approval"],
	[{ review: { reviewer: "stranger" } }, "approval"],
	[{ review: { dispatcher: "spralle" } }, "approval"],
	[{ review: { runAttempt: 2 } }, "approval"],
	[{ review: { protectedMain: false } }, "approval"],
	[{ review: { noBypass: false } }, "approval"],
	[{ review: { environment: "unprotected" } }, "approval"],
	[{ review: { approvedRunId: 41 } }, "approval"],
];

describe("disabled RC source inspection", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-27T11:00:00Z"));
		vi.clearAllMocks();
		files.mockReset();
	});
	afterEach(() => vi.useRealTimers());
	it.each(invalidEvidence)("rejects bad evidence %# without writes", async (change, message) => {
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
				live,
			),
		).rejects.toThrow(message);
		expect(files).not.toHaveBeenCalled();
	});

	it("rejects edited pre.json and source drift without writes", async () => {
		files.mockResolvedValue(JSON.stringify({ mode: "exit", tag: "rc", changesets: [] }));
		await expect(inspectRcSource("/mock", context, plan, reader, source, go, review, live)).rejects.toThrow(
			"prerelease",
		);
		expect(reader.tag).not.toHaveBeenCalled();
	});

	it.each([
		[
			"refresh without exact-head owner consent",
			`${api}/issues/comments/1234`,
			{ user: { login: "stranger" } },
			"consent",
		],
		[
			"owner comment edited after merge",
			`${api}/issues/comments/1234`,
			{ id: 1234, user: { login: "spralle", id: 806157 }, updated_at: "2026-09-27T10:00:00Z" },
			"consent",
		],
		[
			"unrelated file changed with same count and IDs",
			`${api}/pulls/298/files?per_page=100`,
			[{ filename: "packages/other/package.json", sha: "e".repeat(40), status: "modified" }],
			"diff",
		],
		[
			"unreviewed merge parent",
			`${api}/commits/${sha}`,
			{ parents: [{ sha: base }, { sha: base }], commit: { tree: { sha: tree } } },
			"ancestry",
		],
		["protected main advanced", `${api}/commits/main`, { sha: head, commit: { tree: { sha: tree } } }, "main"],
		["GO not posted to #250", `${api}/issues/comments/123`, { id: 123, body: `FINAL GO\n${JSON.stringify(go)}` }, "GO"],
		[
			"GO run is not on merge SHA",
			`${api}/actions/runs/42/attempts/1`,
			{ id: 42, run_attempt: 1, created_at: go.runCreatedAt, head_sha: head, head_branch: "main" },
			"GO",
		],
	])("denies %s", async (_label, url, body, message) => {
		const altered: ReadOnlyTransport = { get: async (path) => (path === url ? { status: 200, body } : live.get(path)) };
		await expect(inspectRcSource("/mock", context, plan, reader, source, go, review, altered)).rejects.toThrow(message);
		expect(files).not.toHaveBeenCalled();
	});

	it("denies stale PR and stale GO after a bot refresh", async () => {
		const refreshed: ReadOnlyTransport = {
			get: async (path) =>
				path === `${api}/pulls/298`
					? { status: 200, body: { head: { sha: "f".repeat(40) }, base: { sha: base }, merged: true } }
					: live.get(path),
		};
		await expect(inspectRcSource("/mock", context, plan, reader, source, go, review, refreshed)).rejects.toThrow(
			"identity drift",
		);
		await expect(
			inspectRcSource("/mock", context, plan, reader, source, { ...go, mergeCommit: head }, review, live),
		).rejects.toThrow("GO");
	});

	it("denies an authenticated merge with the right parents but unreviewed resolution edits", async () => {
		const otherTree = "f".repeat(40);
		const altered: ReadOnlyTransport = {
			get: async (path) => {
				if (path === `${api}/commits/${sha}`)
					return {
						status: 200,
						body: { parents: [{ sha: base }, { sha: head }], commit: { tree: { sha: otherTree } } },
					};
				if (path === `${api}/commits/main`) return { status: 200, body: { sha, commit: { tree: { sha: otherTree } } } };
				return live.get(path);
			},
		};
		await expect(
			inspectRcSource(
				"/mock",
				context,
				plan,
				reader,
				{ ...source, mainTree: otherTree, reviewedMainTree: otherTree },
				{ ...go, tree: otherTree },
				review,
				altered,
			),
		).rejects.toThrow("unreviewed merge ancestry or tree");
		await expect(inspectRcSource("/mock", context, plan, reader, source, go, review, altered)).rejects.toThrow(
			"unreviewed merge ancestry or tree",
		);
		// Spoofing the reviewed tree cannot replace the live PR HEAD tree.
		expect(files).not.toHaveBeenCalled();
	});

	it("uses the trusted current clock, not replayed or edited checkedAt", async () => {
		vi.setSystemTime(new Date("2026-09-28T11:00:00Z"));
		await expect(inspectRcSource("/mock", context, plan, reader, source, go, review, live)).rejects.toThrow("GO");
		await expect(
			inspectRcSource(
				"/mock",
				context,
				plan,
				reader,
				source,
				{ ...go, checkedAt: "2026-09-28T11:00:00Z" },
				review,
				live,
			),
		).rejects.toThrow("GO");
		vi.setSystemTime(new Date("2026-09-27T11:00:00Z"));
		await expect(
			inspectRcSource(
				"/mock",
				context,
				plan,
				reader,
				source,
				{ ...go, checkedAt: "2026-09-27T11:06:00Z" },
				review,
				live,
			),
		).rejects.toThrow("GO");
		await expect(
			inspectRcSource(
				"/mock",
				context,
				plan,
				reader,
				source,
				{ ...go, checkedAt: "2026-09-27T10:54:00Z" },
				review,
				live,
			),
		).rejects.toThrow("GO");
		expect(files).not.toHaveBeenCalled();
	});

	it("rejects registry collisions and all tag/release conflicts before any write", async () => {
		files.mockImplementation(async (path: string) => {
			if (path.endsWith("pre.json"))
				return JSON.stringify({
					mode: "pre",
					tag: "rc",
					initialVersions,
					changesets: consumed,
				});
			if (path.endsWith("CHANGELOG.md")) return "## 0.23.0-rc.0\n\nnotes";
			const name = path.split("/").at(-2);
			return JSON.stringify({
				name: `@formbar/${name}`,
				version: "0.23.0-rc.0",
				dependencies: Object.fromEntries(
					(rcEdges[name ?? ""] ?? []).map((edge) => [`@formbar/${edge}`, "^0.23.0-rc.0"]),
				),
			});
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
				live,
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
				live,
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
				live,
			),
		).rejects.toThrow("draft");
		await expect(inspectRcSource("/mock", context, plan, reader, source, go, review, live)).resolves.toBeUndefined();
		await expect(
			inspectRcSource(
				"/mock",
				context,
				plan,
				{ ...reader, npmVersion: async () => ({ exists: true, gitHead: sha }) },
				source,
				go,
				review,
				live,
			),
		).resolves.toBeUndefined();
		files.mockImplementation(async (path: string) => {
			if (path.endsWith("pre.json")) return JSON.stringify({ mode: "pre", tag: "rc", changesets: [] });
			return "";
		});
		await expect(inspectRcSource("/mock", context, plan, reader, source, go, review, live)).rejects.toThrow(
			"consumed IDs",
		);
	});
});
