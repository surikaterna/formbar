import { type GitHubRead, repo, requireThat } from "./live-evidence-shape";

// GET-only client; no CLI entrypoint, token source or mutating HTTP method is exported.
export function createGitHubRead(token: string, fetcher: typeof fetch = fetch): GitHubRead {
	requireThat(token.length > 0, "missing GitHub read token");
	return {
		async get(path: string): Promise<unknown> {
			requireThat(path.startsWith(`${repo}/`) && /^[a-zA-Z0-9_/?=&.\-]+$/.test(path), "invalid GitHub REST path");
			const response = await fetcher(`https://api.github.com/${path}`, {
				method: "GET",
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": "2022-11-28",
				},
			});
			requireThat(response.ok, `GitHub REST ${response.status} for ${path}`);
			return response.json();
		},
	};
}
