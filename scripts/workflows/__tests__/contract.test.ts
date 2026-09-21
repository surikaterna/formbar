import { describe, expect, it } from "vitest";
import { expectedWorkflowRef, guardStep, loadWorkflow, loadWorkflowSource, workflowCases } from "./fixtures";

const recoveryInputs = ["expected_main_sha", "recovery_issue"];

describe("recovery workflow contract", () => {
	it.each(workflowCases)("preserves $name triggers and requires typed recovery inputs", async ({ file, name }) => {
		const workflow = await loadWorkflow(file);
		expect(workflow.name).toBe(name);
		expect(workflow.on.push).toEqual({ branches: ["main"] });
		if (file === "ci.yml") expect(workflow.on.pull_request).toEqual({ branches: ["main"] });

		const dispatch = workflow.on.workflow_dispatch as { inputs: Record<string, unknown> };
		expect(Object.keys(dispatch.inputs)).toEqual(recoveryInputs);
		for (const input of recoveryInputs) {
			expect(dispatch.inputs[input]).toMatchObject({ required: true, type: "string" });
		}
	});

	it.each(workflowCases)("puts the conditional recovery guard first in $file", async ({ file, job }) => {
		const step = guardStep(await loadWorkflow(file), job);
		expect(step).toMatchObject({
			name: "Validate exact-SHA recovery",
			if: "github.event_name == 'workflow_dispatch'",
			shell: "bash",
		});
		expect(step.env).toMatchObject({
			EXPECTED_MAIN_SHA: "${{ inputs.expected_main_sha }}",
			EXPECTED_WORKFLOW_REF: expectedWorkflowRef(file),
			GH_TOKEN: "${{ github.token }}",
			RECOVERY_ISSUE: "${{ inputs.recovery_issue }}",
		});
		expect(step.run).toContain("set -euo pipefail");
	});

	it("keeps all guards identical except for the workflow filename", async () => {
		const guards = await Promise.all(
			workflowCases.map(async ({ file, job }) => {
				const step = structuredClone(guardStep(await loadWorkflow(file), job));
				if (!step.env) throw new Error("Guard environment is missing");
				step.env.EXPECTED_WORKFLOW_REF = step.env.EXPECTED_WORKFLOW_REF.replace(file, "WORKFLOW.yml");
				return step;
			}),
		);
		expect(guards[1]).toEqual(guards[0]);
		expect(guards[2]).toEqual(guards[0]);
	});

	it("preserves least-privilege workflow permissions and concurrency", async () => {
		const [ci, release, pages] = await Promise.all(workflowCases.map(({ file }) => loadWorkflow(file)));
		expect(ci.permissions).toEqual({ contents: "read", issues: "read" });
		expect(ci.concurrency).toBeUndefined();
		expect(release.permissions).toEqual({
			contents: "write",
			issues: "read",
			"pull-requests": "write",
			"id-token": "write",
		});
		expect(release.concurrency).toBe("${{ github.workflow }}-${{ github.ref }}");
		expect(pages.permissions).toEqual({ contents: "read", issues: "read", pages: "write", "id-token": "write" });
		expect(pages.concurrency).toEqual({ group: "pages", "cancel-in-progress": true });
	});

	it.each(workflowCases)("does not allow input-derived or explicit checkout refs in $file", async ({ file, job }) => {
		const workflow = await loadWorkflow(file);
		const checkout = workflow.jobs[job].steps.find((step) => step.uses?.startsWith("actions/checkout@"));
		expect(checkout).toEqual({ name: "Checkout", uses: "actions/checkout@v5" });
		expect(JSON.stringify(checkout)).not.toContain("inputs.");
	});

	it("retains the direct release identity, Changesets ordering, and OIDC provenance", async () => {
		const release = await loadWorkflow("release.yml");
		const steps = release.jobs.publish.steps;
		const names = steps.map(({ name }) => name);
		expect(release.name).toBe("Publish");
		expect(release.jobs.publish.if).toBe("github.repository == 'surikaterna/formbar'");
		expect(names.indexOf("Version packages")).toBeLessThan(names.indexOf("Preflight release artifacts"));
		expect(names.indexOf("Preflight release artifacts")).toBeLessThan(names.indexOf("Publish packages"));
		expect(names.indexOf("Publish packages")).toBeLessThan(names.indexOf("Reconcile release artifacts"));

		const changesets = steps.find(({ name }) => name === "Version packages");
		expect(changesets).toMatchObject({ uses: "changesets/action@v1" });
		const releaseSteps = steps.filter(({ name }) =>
			["Preflight release artifacts", "Publish packages", "Reconcile release artifacts"].includes(name ?? ""),
		);
		for (const step of releaseSteps) expect(step.if).toBe("steps.changesets.outputs.hasChangesets == 'false'");
		expect(steps.find(({ name }) => name === "Publish packages")).toMatchObject({
			run: "bunx changeset publish",
			env: { NPM_CONFIG_PROVENANCE: "true" },
		});
	});

	it("contains no token publishing, manual fallback, or reusable coordinator", async () => {
		const sources = await Promise.all(workflowCases.map(({ file }) => loadWorkflowSource(file)));
		const combined = sources.join("\n");
		expect(combined).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
		expect(combined).not.toMatch(/(?:npm|pnpm|yarn|bun) publish|workflow_call|uses:\s+\.\/\.github\/workflows/);
	});
});
