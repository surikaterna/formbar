import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const capture = vi.hoisted(() => ({ env: {} as NodeJS.ProcessEnv }));
vi.mock("node:child_process", async (original) => ({
	...(await original<typeof import("node:child_process")>()),
	execFile: (
		_node: string,
		_args: string[],
		options: { env: NodeJS.ProcessEnv },
		callback: (...args: unknown[]) => void,
	) => {
		capture.env = options.env;
		callback(null, "", "");
	},
}));
vi.mock("../rc-publish-toolchain", () => ({ assertPinnedPublishTools: vi.fn() }));
import { publishProtected } from "../rc-protected-providers";

afterEach(() => vi.unstubAllEnvs());

function tools() {
	const node = process.env.RC_NODE_BINARY;
	const npm = process.env.RC_NPM_ROOT;
	if (!node || !npm || !isAbsolute(node) || !isAbsolute(npm))
		throw new Error("required explicit offline tool pins missing");
	expect(execFileSync(node, ["--version"], { encoding: "utf8" })).toBe("v22.23.2\n");
	expect(JSON.parse(readFileSync(join(npm, "package.json"), "utf8")).version).toBe("11.20.0");
	expect(
		createHash("sha256")
			.update(readFileSync(join(npm, "bin/npm-cli.js")))
			.digest("hex"),
	).toBe("8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7");
	return { node, npm };
}

async function childEnvironment() {
	for (const [key, value] of Object.entries({
		GITHUB_ACTIONS: "true",
		GITHUB_REPOSITORY: "surikaterna/formbar",
		GITHUB_EVENT_NAME: "workflow_dispatch",
		GITHUB_REPOSITORY_ID: "1245476636",
		GITHUB_REPOSITORY_OWNER_ID: "9478205",
		GITHUB_SERVER_URL: "https://github.com",
		GITHUB_SHA: "a".repeat(40),
		GITHUB_REF: "refs/heads/main",
		GITHUB_WORKFLOW_REF: "surikaterna/formbar/.github/workflows/release.yml@refs/heads/main",
		GITHUB_RUN_ID: "12345",
		GITHUB_RUN_ATTEMPT: "1",
		ACTIONS_ID_TOKEN_REQUEST_URL: "https://never.invalid",
		ACTIONS_ID_TOKEN_REQUEST_TOKEN: "test-only",
	}))
		vi.stubEnv(key, value);
	await publishProtected("@formbar/expressions", Buffer.from("offline fixture"));
	// Remove the existing OIDC wiring from this test-only generator child, not from production.
	return Object.fromEntries(Object.entries(capture.env).filter(([key]) => !key.startsWith("ACTIONS_ID_TOKEN_")));
}

it("#439 requires the real pinned npm generator: fixed public allowlist versus old omission, unsigned and offline", async () => {
	const { node, npm } = tools();
	const env = await childEnvironment();
	const result = JSON.parse(
		execFileSync(node, [resolve("scripts/release/__tests__/rc-provenance-offline.cjs"), npm], {
			env,
			encoding: "utf8",
			timeout: 10_000,
		}),
	);
	const [fixed, omitted] = result.payloads.map((bytes: string) => JSON.parse(Buffer.from(bytes, "base64").toString()));
	expect(fixed.predicate.buildDefinition.internalParameters.github).toEqual({
		event_name: "workflow_dispatch",
		repository_id: "1245476636",
		repository_owner_id: "9478205",
	});
	expect(omitted.predicate.buildDefinition.internalParameters.github).toEqual({});
	expect(result.counters).toEqual({ network: 0, oidc: 0, signing: 0, put: 0, attestStub: 2 });
	expect(fixed.subject).toEqual(omitted.subject);
	expect(fixed.predicate.buildDefinition.externalParameters.workflow).toEqual({
		ref: "refs/heads/main",
		repository: "https://github.com/surikaterna/formbar",
		path: ".github/workflows/release.yml",
	});
	expect(fixed.predicate.runDetails.metadata.invocationId).toBe(
		"https://github.com/surikaterna/formbar/actions/runs/12345/attempts/1",
	);
	fixed.predicate.buildDefinition.internalParameters.github = {};
	expect(fixed).toEqual(omitted);
});
