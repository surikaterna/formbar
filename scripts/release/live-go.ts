import { type GitHubRead, object, pages, rcNames, repo, requireThat, sha } from "./live-evidence-shape";

const dependencies: Record<string, string[]> = {
	arbiter: ["core", "expressions"],
	core: ["expressions"],
	declarative: ["core", "expressions"],
	"from-schema": ["core", "declarative", "expressions"],
	react: ["core", "expressions"],
	"react-schema": ["core", "declarative", "from-schema", "react"],
};

export function verifyGoBody(body: unknown, runId: number, commit: string, tree: string): void {
	requireThat(typeof body === "string" && body.startsWith("FINAL GO\n"), "missing FINAL GO");
	let parsed: unknown;
	try {
		parsed = JSON.parse(body.slice("FINAL GO\n".length));
	} catch {
		throw new Error("RC evidence denied: malformed GO JSON");
	}
	const go = object(parsed);
	requireThat(
		JSON.stringify(go) === body.slice("FINAL GO\n".length),
		"GO must be canonical JSON without duplicate keys",
	);
	requireThat(
		Object.keys(go).sort().join(",") === "acknowledges_legacy_validation_issue,attempt,run_id,sha,tree,versions" &&
			go.run_id === runId &&
			go.attempt === 1 &&
			go.sha === commit &&
			go.tree === tree &&
			go.acknowledges_legacy_validation_issue ===
				"I acknowledge the global/default legacy ValidationIssue identity, mutability and non-JSON shape migration.",
		"GO run, SHA, tree or migration acknowledgement differs",
	);
	const versions = object(go.versions);
	requireThat(
		Object.keys(versions).sort().join(",") ===
			rcNames
				.map((name) => `@formbar/${name}`)
				.sort()
				.join(","),
		"GO package set differs",
	);
	for (const name of rcNames) {
		const version = object(versions[`@formbar/${name}`]);
		requireThat(
			Object.keys(version).sort().join(",") === "dependencies,version" && version.version === "0.23.0-rc.0",
			"GO rc version differs",
		);
		const ranges = object(version.dependencies);
		requireThat(
			Object.keys(ranges).sort().join(",") ===
				dependencies[name]
					.map((dep) => `@formbar/${dep}`)
					.sort()
					.join(","),
			"GO dependency set differs",
		);
		for (const dep of dependencies[name])
			requireThat(
				ranges[`@formbar/${dep}`] === (dep === "expressions" ? "^0.14.3" : "^0.23.0-rc.0"),
				"GO internal range differs",
			);
	}
}

export async function verifyFreshGo(
	api: GitHubRead,
	runId: number,
	createdAt: string,
	commit: string,
	tree: string,
	now: Date,
): Promise<number> {
	const created = Date.parse(createdAt);
	requireThat(Number.isFinite(created) && Number.isFinite(now.getTime()), "run time missing");
	const listing = await pages(api, `${repo}/issues/250/comments`);
	const matches = listing.map(object).filter((comment) => {
		if (typeof comment.body !== "string" || !comment.body.startsWith("FINAL GO\n")) return false;
		let candidate: unknown;
		try {
			candidate = JSON.parse(comment.body.slice("FINAL GO\n".length));
		} catch {
			throw new Error("RC evidence denied: malformed FINAL GO in #250");
		}
		return object(candidate).run_id === runId;
	});
	requireThat(matches.length === 1, "missing or ambiguous run-bound FINAL GO");
	const id = matches[0].id;
	requireThat(Number.isSafeInteger(id) && (id as number) > 0, "GO comment id missing");
	const comment = object(await api.get(`${repo}/issues/comments/${id}`));
	requireThat(
		comment.id === id &&
			comment.body === matches[0].body &&
			comment.issue_url === `https://api.github.com/${repo}/issues/250` &&
			object(comment.user).id === 806157,
		"GO comment identity or issue differs",
	);
	const timestamp = Date.parse(String(comment.created_at));
	requireThat(
		sha.test(commit) &&
			sha.test(tree) &&
			comment.created_at === comment.updated_at &&
			Number.isFinite(timestamp) &&
			timestamp > created &&
			timestamp <= now.getTime() &&
			now.getTime() - timestamp < 86_400_000,
		"GO edited, stale or predates run",
	);
	verifyGoBody(comment.body, runId, commit, tree);
	return id as number;
}
