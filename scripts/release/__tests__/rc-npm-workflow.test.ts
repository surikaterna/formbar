import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";

const workflow = YAML.parse(readFileSync(resolve(".github/workflows/release.yml"), "utf8"));
const steps = workflow.jobs["protected-rc"].steps as { name: string; run?: string }[];
const setup = steps.find((step) => step.name === "Install pinned npm and build after preflight")?.run;
const publish = steps.find((step) => step.name === "Revalidate and publish only reviewed seven RC tarballs")?.run;
const entry =
	"bun -e \"import('./scripts/release/rc-protected.ts').then(({runProtectedRc}) => runProtectedRc()).catch((error) => { console.error(error); process.exitCode = 1 })\"";

describe("#420 real workflow npm isolation (no OIDC or publish)", () => {
	it("keeps the setup pin and protected entrypoint, with no bypass", () => {
		expect(setup).toContain("npm@11.20.0");
		expect(setup).toContain('[[ "$(npm --version)" == 11.20.0 ]]');
		expect(publish?.trimEnd().endsWith(entry)).toBe(true);
		expect(publish).not.toMatch(/GO_BYPASS|BYTE_BYPASS|NPM_TOKEN=|\.npmrc\s*>/);
	});

	it.each(["clean", "project-config", "home-config", "token", "failed-entry", "same-config"])(
		"%s: executes the parsed publish setup with real npm and cleans up",
		(scenario) => {
			if (!publish?.trimEnd().endsWith(entry)) throw new Error("publish entrypoint changed");
			const directory = mkdtempSync(join(tmpdir(), "formbar-rc-npm-workflow-"));
			const runner = join(directory, "runner");
			const home = join(directory, "home");
			const checkout = join(directory, "checkout");
			const probe = join(directory, "probe.json");
			try {
				for (const name of [runner, home, checkout]) mkdirSync(name);
				if (scenario === "project-config")
					writeFileSync(join(checkout, ".npmrc"), "//registry.npmjs.org/:_authToken=bad\n");
				if (scenario === "home-config") writeFileSync(join(home, ".npmrc"), "//registry.npmjs.org/:_authToken=bad\n");
				const source = scenario === "same-config" ? publish.replace("global.npmrc", "user.npmrc") : publish;
				const script = `${source.trimEnd().slice(0, -entry.length)}node ${JSON.stringify(join(resolve("."), "scripts/release/__tests__/rc-npm-probe.cjs"))}`;
				const env = {
					...process.env,
					HOME: home,
					RUNNER_TEMP: runner,
					TEST_PROBE_FILE: probe,
					TEST_FAIL_ENTRY: scenario === "failed-entry" ? "true" : "false",
					NPM_TOKEN: scenario === "token" ? "bad" : "",
					NODE_AUTH_TOKEN: "",
				};
				env.npm_config_userconfig = undefined;
				env.npm_config_globalconfig = undefined;
				const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "-c", script], {
					cwd: checkout,
					env,
					encoding: "utf8",
				});
				expect(result.status, result.stderr).toBe(
					["clean", "home-config"].includes(scenario) ? 0 : scenario === "failed-entry" ? 17 : 1,
				);
				expect(existsSync(probe)).toBe(["clean", "home-config", "failed-entry"].includes(scenario));
				if (existsSync(probe)) {
					const data = JSON.parse(readFileSync(probe, "utf8"));
					if (process.env.RC_TEST_PINNED_NPM === "1") expect(data.version).toBe("11.20.0");
					expect(data.user).not.toBe(data.global);
					expect(data.list).not.toMatch(/_authToken|bad/);
				}
				expect(readdirSync(runner)).toEqual([]);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		},
	);
});
