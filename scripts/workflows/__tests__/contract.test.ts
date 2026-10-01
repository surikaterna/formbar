import { describe, expect, it } from "vitest";
import type { WorkflowStep } from "./fixtures";
import { expectedWorkflowRef, guardStep, loadWorkflow, loadWorkflowSource, workflowCases } from "./fixtures";

const recoveryInputs = ["expected_main_sha", "recovery_issue"];
const historyCases = [
	{ file: "ci.yml", job: "ci" },
	{ file: "release.yml", job: "publish-rc" },
] as const;

function expectCheckout(file: string, checkout: WorkflowStep | undefined) {
	expect(checkout).toEqual({
		name: "Checkout",
		uses: "actions/checkout@v5",
		...(historyCases.some((entry) => entry.file === file) ? { with: { "fetch-depth": 0 } } : {}),
	});
	expect(JSON.stringify(checkout)).not.toContain("inputs.");
}

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
	});
});

describe("recovery workflow permissions contract", () => {
	it("preserves least-privilege workflow permissions and concurrency", async () => {
		const [ci, pages] = await Promise.all(workflowCases.map(({ file }) => loadWorkflow(file)));
		expect(ci.permissions).toEqual({ contents: "read", issues: "read" });
		expect(ci.concurrency).toBeUndefined();
		expect(pages.permissions).toEqual({ contents: "read", issues: "read", pages: "write", "id-token": "write" });
		expect(pages.concurrency).toEqual({ group: "pages", "cancel-in-progress": true });
	});
});

describe("checkout history contract", () => {
	it.each([...historyCases, { file: "pages.yml", job: "build" }])(
		"requires exact checkout history/options in $file",
		async ({ file, job }) => {
			const workflow = await loadWorkflow(file);
			const checkout = workflow.jobs[job].steps.find((step) => step.uses?.startsWith("actions/checkout@"));
			expectCheckout(file, checkout);
		},
	);

	it.each(historyCases)("rejects missing/shallow history, refs and extra config in $file", async ({ file, job }) => {
		const workflow = await loadWorkflow(file);
		const checkout = workflow.jobs[job].steps.find((step) => step.uses?.startsWith("actions/checkout@"));
		for (const options of [
			{ name: "missing full history", options: undefined },
			{ name: "empty options", options: {} },
			{ name: "default shallow history", options: { "fetch-depth": 1 } },
			{ name: "nonzero depth", options: { "fetch-depth": 2 } },
			{ name: "string depth", options: { "fetch-depth": "0" } },
			{ name: "extra option", options: { "fetch-depth": 0, "fetch-tags": true } },
			{ name: "explicit ref", options: { "fetch-depth": 0, ref: "main" } },
			{ name: "input-derived ref", options: { "fetch-depth": 0, ref: "${{ inputs.expected_main_sha }}" } },
		]) {
			expect(() => expectCheckout(file, { ...checkout, with: options.options }), options.name).toThrow();
		}
		expect(() => expectCheckout(file, { ...checkout, env: { ACTOR: "other" } })).toThrow();
	});

	it("does not extend full history to Pages", async () => {
		const workflow = await loadWorkflow("pages.yml");
		const checkout = workflow.jobs.build.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
		expect(() => expectCheckout("pages.yml", { ...checkout, with: { "fetch-depth": 0 } })).toThrow();
	});
});

describe("recovery workflow publication contract", () => {
	it("contains no token publishing, manual fallback, or reusable coordinator", async () => {
		const sources = await Promise.all(workflowCases.map(({ file }) => loadWorkflowSource(file)));
		const combined = sources.join("\n");
		expect(combined).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN/);
		expect(combined).not.toMatch(/(?:npm|pnpm|yarn|bun) publish|workflow_call|uses:\s+\.\/\.github\/workflows/);
	});
});
