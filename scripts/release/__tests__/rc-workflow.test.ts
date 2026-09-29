import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { checkChangelog, rcPackages, rcVersion } from "../rc-reviewed-plan";
import { endpointResponses, versionedCheckout } from "./rc-workflow-fixture";

const root = resolve(".");
const workflow = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
const parsed = YAML.parse(workflow) as {
	jobs: Record<string, { steps: { name: string; run?: string; uses?: string }[] }>;
};
const steps = parsed.jobs["protected-rc"].steps;
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function driftEndpoints(endpoints: Record<string, unknown>, scenario: string, sha: string, tree: string): void {
	const api = "repos/surikaterna/formbar";
	const goPath = `${api}/issues/250/comments?per_page=100&page=1`;
	if (scenario === "missing GO") endpoints[goPath] = [];
	if (scenario === "wrong GO") {
		const comment = (endpoints[goPath] as Record<string, unknown>[])[0];
		endpoints[goPath] = [{ ...comment, body: String(comment.body).replace('"run_id":12345', '"run_id":99999') }];
	}
	if (scenario === "wrong tree") (endpoints[`${api}/git/commits/${sha}`] as { tree: { sha: string } }).tree.sha = sha;
	if (scenario === "wrong SHA") (endpoints[`${api}/branches/main`] as { commit: { sha: string } }).commit.sha = tree;
	if (scenario === "CI")
		(
			endpoints[`${api}/commits/${sha}/check-runs?per_page=100&page=1`] as { check_runs: { conclusion: string }[] }
		).check_runs[0].conclusion = "failure";
	if (scenario === "policy")
		(endpoints[`${api}/rulesets/24103769`] as { enforcement: string }).enforcement = "disabled";
	if (scenario === "reviewer")
		(endpoints[`${api}/actions/runs/12345/approvals`] as { user: { id: number } }[])[0].user.id = 1532734;
	if (scenario === "403") endpoints.deny = `${api}/actions/runs/12345`;
}

function fakeWorkflowEnv(sha: string, event: string, responses: string, requests: string): NodeJS.ProcessEnv {
	return {
		...process.env,
		RC_TEST_RESPONSES: responses,
		RC_TEST_REQUESTS: requests,
		GITHUB_TOKEN: "fake-read-token",
		GITHUB_EVENT_PATH: event,
		GITHUB_RUN_ID: "12345",
		GITHUB_RUN_ATTEMPT: "1",
		GITHUB_ACTOR: "eaglez",
		GITHUB_SHA: sha,
		GITHUB_REPOSITORY: "surikaterna/formbar",
		GITHUB_EVENT_NAME: "workflow_dispatch",
		GITHUB_REF: "refs/heads/main",
		GITHUB_WORKFLOW_REF: "surikaterna/formbar/.github/workflows/release.yml@refs/heads/main",
		GITHUB_WORKFLOW_SHA: sha,
		ACTIONS_ID_TOKEN_REQUEST_URL: "https://oidc.fixture.invalid/token",
	};
}

async function runBundle(checkout: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; error: string }> {
	const command = steps[1].run;
	if (command !== "node scripts/release/rc-preflight.mjs") throw new Error("workflow gate changed");
	return new Promise((done) => {
		const child = spawn(
			process.execPath,
			["--import", join(root, "scripts/release/__tests__/rc-fetch-hook.mjs"), ...command.split(" ").slice(1)],
			{ cwd: checkout, env },
		);
		let error = "";
		child.stderr.on("data", (chunk: Buffer) => {
			error += chunk.toString();
		});
		child.on("close", (code) => done({ code, error }));
	});
}

function unversionedCheckout(dir: string): string {
	const checkout = join(dir, "checkout");
	mkdirSync(join(checkout, ".changeset"), { recursive: true });
	cpSync(join(root, ".changeset/pre.json"), join(checkout, ".changeset/pre.json"));
	for (const name of rcPackages) {
		const packageDir = join(checkout, "packages", name);
		mkdirSync(packageDir, { recursive: true });
		for (const file of ["package.json", "CHANGELOG.md"])
			cpSync(join(root, "packages", name, file), join(packageDir, file));
	}
	mkdirSync(join(checkout, "scripts/release"), { recursive: true });
	cpSync(join(root, "scripts/release/rc-preflight.mjs"), join(checkout, "scripts/release/rc-preflight.mjs"));
	execFileSync("git", ["init", "--quiet", "--template=/dev/null", checkout]);
	execFileSync("git", ["add", "."], { cwd: checkout });
	execFileSync(
		"git",
		["-c", "user.name=fixture", "-c", "user.email=fixture@example.test", "commit", "--quiet", "-m", "fixture"],
		{ cwd: checkout },
	);
	return checkout;
}

describe("#397 protected workflow boundary", () => {
	it("executes only built-in git and Node before GO; keeps push job independent", () => {
		expect(parsed.jobs["version-proposal"].steps).toHaveLength(5);
		expect(parsed.jobs["reject-dispatch"]).toBeUndefined();
		expect(steps.slice(0, 2).map((step) => step.name)).toEqual([
			"Fetch exact protected commit without actions or repository scripts",
			"Live read-only GO and protected-run preflight (runner Node)",
		]);
		expect(steps.slice(0, 2).every((step) => !step.uses)).toBe(true);
		expect(steps[0].run).toContain("git fetch --no-tags --no-recurse-submodules --depth=1");
		expect(steps[0].run).toContain("git init --quiet --template=/dev/null");
		expect(steps[0].run).toContain("git status --porcelain --untracked-files=all");
		expect(steps[1].run).toBe("node scripts/release/rc-preflight.mjs");
		expect(
			steps
				.slice(2)
				.map((step) => step.uses)
				.filter(Boolean),
		).toEqual([
			"oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
			"actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
		]);
		expect(steps.at(-1)?.run).toContain("runProtectedRc()");
	});

	it("binds the pre-GO executable to a reproducible audited bundle", () => {
		const ci = YAML.parse(readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"));
		const setup = ci.jobs.ci.steps.find((step: { name: string }) => step.name === "Setup Bun");
		expect(setup.with["bun-version"]).toBe("1.2.21");
		const bundle = readFileSync(join(root, "scripts/release/rc-preflight.mjs"));
		expect(steps[0].run).toContain(sha256(bundle));
		const dir = mkdtempSync(join(tmpdir(), "formbar-preflight-rebuild-"));
		try {
			const output = join(dir, "rc-preflight.mjs");
			execFileSync(
				"bun",
				[
					"build",
					"scripts/release/rc-preflight-entry.ts",
					"--target=node",
					"--format=esm",
					"--bundle",
					`--outfile=${output}`,
				],
				{ cwd: root },
			);
			expect(readFileSync(output)).toEqual(bundle);
		} finally {
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("bundle uses only built-in imports, local checked-in code and GitHub GET", () => {
		const bundle = readFileSync(join(root, "scripts/release/rc-preflight.mjs"), "utf8");
		const imports = [...bundle.matchAll(/^import .* from "([^"]+)";/gm)].map((match) => match[1]);
		expect(imports.length).toBeGreaterThan(0);
		expect(imports.every((specifier) => specifier.startsWith("node:"))).toBe(true);
		expect(bundle).not.toMatch(/\b(import\(|execFileSync\("npm"|spawn\(|ACTIONS_ID_TOKEN_REQUEST_URL)/);
		expect(bundle).toContain('method: "GET"');
	});

	it.each(["eaglez", "spralle"])(
		"clean unversioned Node checkout denies %s before any OIDC or write",
		async (actor) => {
			const dir = mkdtempSync(join(tmpdir(), "formbar-rc-deny-"));
			const server = createServer((_request, response) => {
				requests++;
				response.writeHead(403).end();
			});
			let requests = 0;
			try {
				const checkout = unversionedCheckout(dir);
				expect(existsSync(join(checkout, "node_modules"))).toBe(false);
				const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: checkout, encoding: "utf8" }).trim();
				const event = join(dir, "event.json");
				writeFileSync(event, JSON.stringify({ sender: { id: 1532734 }, inputs: { expected_main_sha: commit } }));
				await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
				const address = server.address();
				if (!address || typeof address === "string") throw new Error("missing mock OIDC address");
				const env = {
					...process.env,
					GITHUB_TOKEN: "fake-read-token",
					GITHUB_EVENT_PATH: event,
					GITHUB_RUN_ID: "12345",
					GITHUB_RUN_ATTEMPT: "1",
					GITHUB_ACTOR: actor,
					GITHUB_SHA: commit,
					ACTIONS_ID_TOKEN_REQUEST_URL: `http://127.0.0.1:${address.port}/oidc`,
					ACTIONS_ID_TOKEN_REQUEST_TOKEN: "fake-oidc-token",
				};
				const result = await new Promise<number | null>((done) => {
					spawn(process.execPath, ["scripts/release/rc-preflight.mjs"], { cwd: checkout, env, stdio: "ignore" }).on(
						"close",
						done,
					);
				});
				expect(result).toBe(1);
				expect(requests).toBe(0);
				expect(execFileSync("git", ["status", "--porcelain"], { cwd: checkout, encoding: "utf8" })).toBe("");
			} finally {
				server.close();
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);
});

describe("#397 workflow-bound clean Node preflight", () => {
	it("normalizes unversioned and reviewed versioned sources to one identical seven-package RC", async () => {
		const dir = mkdtempSync(join(tmpdir(), "formbar-rc-single-heading-"));
		try {
			const first = versionedCheckout(root, join(dir, "first"));
			const second = versionedCheckout(first.checkout, join(dir, "second"));
			for (const name of rcPackages) {
				const path = join("packages", name, "CHANGELOG.md");
				const text = readFileSync(join(second.checkout, path), "utf8");
				expect(text).toBe(readFileSync(join(first.checkout, path), "utf8"));
				expect(text.split(`## ${rcVersion}\n`)).toHaveLength(2);
				expect(() => checkChangelog(name, text)).not.toThrow();
			}
			const responses = join(dir, "responses.json");
			const requests = join(dir, "requests.log");
			const event = join(dir, "event.json");
			writeFileSync(responses, JSON.stringify(endpointResponses(second.sha, second.tree, new Date())));
			writeFileSync(requests, "");
			writeFileSync(event, JSON.stringify({ sender: { id: 1532734 }, inputs: { expected_main_sha: second.sha } }));
			const result = await runBundle(second.checkout, fakeWorkflowEnv(second.sha, event, responses, requests));
			expect(result.code, result.error).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it.each(["altered content", "duplicate heading", "unknown heading", "altered history"])(
		"rejects %s in an already versioned source rather than laundering it",
		(scenario) => {
			const dir = mkdtempSync(join(tmpdir(), "formbar-rc-drift-"));
			try {
				const source = versionedCheckout(root, join(dir, "source")).checkout;
				const path = join(source, "packages/expressions/CHANGELOG.md");
				const text = readFileSync(path, "utf8");
				const changed = {
					"altered content": text.replace("canonically copy", "silently change"),
					"duplicate heading": text.replace("## 0.14.3", `## ${rcVersion}\n\n## 0.14.3`),
					"unknown heading": text.replace(`## ${rcVersion}`, "## 0.23.0-rc.1"),
					"altered history": `${text}unreviewed history\n`,
				}[scenario as "altered content" | "duplicate heading" | "unknown heading" | "altered history"];
				writeFileSync(path, changed);
				expect(() => versionedCheckout(source, join(dir, "output"))).toThrow();
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);

	it("builds the approved seven-package fixture from a shallow HEAD without node_modules", async () => {
		const dir = mkdtempSync(join(tmpdir(), "formbar-rc-shallow-"));
		try {
			const source = join(dir, "source");
			execFileSync("git", ["clone", "--quiet", "--depth=1", `file://${root}`, source]);
			expect(existsSync(join(source, "node_modules"))).toBe(false);
			expect(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: source, encoding: "utf8" }).trim()).toBe("1");
			const { checkout, sha, tree } = versionedCheckout(source, dir);
			const responsePath = join(dir, "responses.json");
			const requestPath = join(dir, "requests.log");
			const eventPath = join(dir, "event.json");
			writeFileSync(responsePath, JSON.stringify(endpointResponses(sha, tree, new Date())));
			writeFileSync(requestPath, "");
			writeFileSync(eventPath, JSON.stringify({ sender: { id: 1532734 }, inputs: { expected_main_sha: sha } }));
			const result = await runBundle(checkout, fakeWorkflowEnv(sha, eventPath, responsePath, requestPath));
			expect(result.code, result.error).toBe(0);
			expect(existsSync(join(checkout, "node_modules"))).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it.each([
		"valid",
		"missing GO",
		"wrong GO",
		"wrong tree",
		"wrong SHA",
		"wrong version",
		"wrong IDs",
		"wrong changelog",
		"CI",
		"policy",
		"reviewer",
		"403",
	])("%s: real bundled gate only permits the complete approved snapshot", async (scenario) => {
		const dir = mkdtempSync(join(tmpdir(), "formbar-rc-boundary-"));
		try {
			const variant =
				scenario === "wrong version" || scenario === "wrong IDs" || scenario === "wrong changelog"
					? scenario
					: undefined;
			const { checkout, sha, tree } = versionedCheckout(root, dir, variant);
			const responsePath = join(dir, "responses.json");
			const requestPath = join(dir, "requests.log");
			const eventPath = join(dir, "event.json");
			const endpoints = endpointResponses(sha, tree, new Date());
			driftEndpoints(endpoints, scenario, sha, tree);
			writeFileSync(responsePath, JSON.stringify(endpoints));
			writeFileSync(requestPath, "");
			writeFileSync(eventPath, JSON.stringify({ sender: { id: 1532734 }, inputs: { expected_main_sha: sha } }));
			expect(existsSync(join(checkout, "node_modules"))).toBe(false);
			const result = await runBundle(checkout, fakeWorkflowEnv(sha, eventPath, responsePath, requestPath));
			expect(result.code, result.error).toBe(scenario === "valid" ? 0 : 1);
			expect(readFileSync(requestPath, "utf8")).not.toContain("OIDC");
			expect(execFileSync("git", ["status", "--porcelain"], { cwd: checkout, encoding: "utf8" })).toBe("");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
