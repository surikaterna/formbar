import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { rcPackages } from "../rc-reviewed-plan";

const root = resolve(".");
const workflow = readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
const parsed = YAML.parse(workflow) as {
	jobs: Record<string, { steps: { name: string; run?: string; uses?: string }[] }>;
};
const steps = parsed.jobs["protected-rc"].steps;
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

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
