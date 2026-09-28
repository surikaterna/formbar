import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../rc-publish-toolchain", () => ({ assertPinnedPublishTools: vi.fn() }));
import { publishProtected } from "../rc-protected-providers";

const original = { ...process.env };
afterEach(() => {
	process.env = { ...original };
});

describe("production-only npm boundary", () => {
	it.each([
		["no GitHub OIDC", {}],
		["injected npm bearer", { NPM_TOKEN: "fake" }],
		["injected OIDC bearer", { NPM_ID_TOKEN: "fake" }],
		["injected npm auth config", { npm_config__authToken: "fake" }],
	])("denies %s before spawning publish", async (_, extra) => {
		process.env = {
			...original,
			RC_NODE_BINARY: "/nonexistent/pinned-node",
			RC_NPM_ROOT: "/nonexistent/pinned-npm",
			GITHUB_ACTIONS: "true",
			ACTIONS_ID_TOKEN_REQUEST_URL: "https://example.invalid/oidc",
			ACTIONS_ID_TOKEN_REQUEST_TOKEN: "fake-request-token",
			...extra,
		};
		if (_ === "no GitHub OIDC") process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = "";
		await expect(publishProtected("@formbar/expressions", Buffer.from("fixture"))).rejects.toThrow();
	});
});
