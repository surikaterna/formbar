/** Public Actions identity, also bound to the authenticated run by live-evidence. */
export function publicMetadata(env: NodeJS.ProcessEnv) {
	const { GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_REPOSITORY_ID, GITHUB_REPOSITORY_OWNER_ID } = env;
	if (
		GITHUB_REPOSITORY !== "surikaterna/formbar" ||
		GITHUB_EVENT_NAME !== "workflow_dispatch" ||
		GITHUB_REPOSITORY_ID !== "1245476636" ||
		GITHUB_REPOSITORY_OWNER_ID !== "9478205"
	)
		throw new Error("public Actions provenance identity differs");
	return Object.freeze({ GITHUB_REPOSITORY, GITHUB_EVENT_NAME, GITHUB_REPOSITORY_ID, GITHUB_REPOSITORY_OWNER_ID });
}

export type PublicMetadata = ReturnType<typeof publicMetadata>;
