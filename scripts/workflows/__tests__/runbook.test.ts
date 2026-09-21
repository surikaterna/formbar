import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";
import { repositoryRoot } from "./fixtures";

const execute = promisify(execFile);

describe("recovery runbook", () => {
	let runbook = "";

	beforeAll(async () => {
		runbook = await readFile(join(repositoryRoot, "docs", "workflow-recovery.md"), "utf8");
	});

	it("requires URL-returning gh behavior and fails closed without an exact dispatch URL", () => {
		expect(runbook).toContain("GitHub CLI 2.100.0 or newer");
		expect(runbook).toContain('run_url="$(gh workflow run "$workflow"');
		expect(runbook).toContain("^https://github\\.com/surikaterna/formbar/actions/runs/[1-9][0-9]*$");
		expect(runbook).not.toMatch(/gh run list|--limit\s+1/);
	});

	it("contains syntactically valid Bash commands", async () => {
		const blocks = [...runbook.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]);
		expect(blocks).toHaveLength(5);
		await expect(execute("bash", ["-n", "-c", blocks.join("\n")])).resolves.toBeDefined();
	});

	it("retains each directly returned run URL and derives its exact ID", () => {
		for (const prefix of ["CI", "PUBLISH", "PAGES"]) {
			expect(runbook).toContain(`${prefix}_RUN_URL="$(dispatch_run`);
			expect(runbook).toContain(`${prefix}_RUN_ID="\${${prefix}_RUN_URL##*/}"`);
			expect(runbook).toContain(`record_run "$${prefix}_RUN_ID" "$${prefix}_RUN_URL"`);
		}
	});

	it("validates exact run metadata before preserving CI-first ordering", () => {
		for (const field of ["databaseId", "url", "event", "headBranch", "headSha", "workflowName", "status"]) {
			expect(runbook).toContain(field);
		}
		expect(runbook).toContain('[[ "$event" == workflow_dispatch ]]');
		expect(runbook).toContain('[[ "$branch" == main ]]');
		expect(runbook).toContain('[[ "$sha" == "$SHA" ]]');

		const ciWatch = runbook.indexOf('gh run watch --repo "$REPO" "$CI_RUN_ID" --exit-status');
		expect(runbook.indexOf('CI_RUN_URL="$(dispatch_run ci.yml)"')).toBeLessThan(ciWatch);
		expect(ciWatch).toBeLessThan(runbook.indexOf('PUBLISH_RUN_URL="$(dispatch_run release.yml)"'));
		expect(ciWatch).toBeLessThan(runbook.indexOf('PAGES_RUN_URL="$(dispatch_run pages.yml)"'));
	});

	it("binds successful guard evidence to the common issue and SHA", () => {
		expect(runbook).toContain("RECOVERY_EVIDENCE recovery_issue=$ISSUE expected_main_sha=$SHA");
		expect(runbook).toContain('select(.name == "Validate exact-SHA recovery")');
		expect(runbook).toContain("== success");
		expect(runbook).toContain("same issue and SHA");
	});
});
