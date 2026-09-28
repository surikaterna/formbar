import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { RunWitness } from "../live-evidence";
import { dispatchWitness, inspectDispatch } from "../rc-dispatch-gate";

const sha = "a".repeat(40);
const tree = "b".repeat(40);
const env = {
	GITHUB_RUN_ID: "12345",
	GITHUB_RUN_ATTEMPT: "1",
	GITHUB_EVENT_PATH: "/tmp/dispatch.json",
	GITHUB_TOKEN: "mock-read-token",
	GITHUB_ACTOR: "eaglez",
	GITHUB_REPOSITORY: "surikaterna/formbar",
	GITHUB_EVENT_NAME: "workflow_dispatch",
	GITHUB_REF: "refs/heads/main",
	GITHUB_WORKFLOW_REF: "surikaterna/formbar/.github/workflows/release.yml@refs/heads/main",
	GITHUB_WORKFLOW_SHA: sha,
	GITHUB_SHA: sha,
	EXPECTED_MAIN_SHA: sha,
};
const checkout = { sha, tree, clean: true };
const event = { sender: { id: 1532734 } };

describe("#363 protected read-only dispatch checkpoint", () => {
	it("maps only GitHub runtime and event fields to #365 witness", () => {
		expect(dispatchWitness(env, event, checkout)).toMatchObject({
			runId: 12345,
			attempt: 1,
			senderId: 1532734,
			checkoutTree: tree,
			expectedSha: sha,
		});
	});
	it.each([
		{ GITHUB_EVENT_NAME: "push" },
		{ GITHUB_ACTOR: "spralle" },
		{ GITHUB_REF: "refs/heads/feature" },
		{ GITHUB_SHA: tree },
		{ GITHUB_WORKFLOW_SHA: tree },
		{ GITHUB_RUN_ATTEMPT: "2" },
		{ EXPECTED_MAIN_SHA: tree },
	])("denies forged or drifted runtime %o without a GET", async (change) => {
		const read = vi.fn();
		await expect(
			inspectDispatch(resolve("."), { ...env, ...change }, event, checkout, read, new Date()),
		).rejects.toThrow();
		expect(read).not.toHaveBeenCalled();
	});
	it("denies missing token, nonnumeric run ID and dirty checkout", () => {
		expect(() => dispatchWitness({ ...env, GITHUB_TOKEN: "" }, event, checkout)).toThrow();
		expect(() => dispatchWitness({ ...env, GITHUB_RUN_ID: "1e3" }, event, checkout)).toThrow();
		expect(() => dispatchWitness(env, event, { ...checkout, clean: false })).toThrow();
	});
	it("rejects unversioned main before contacting live evidence, even after approval", async () => {
		const read = vi.fn(async (_api: unknown, _witness: RunWitness, _now: Date) => ({ commentId: 456 }));
		await expect(inspectDispatch(resolve("."), env, event, checkout, read, new Date())).rejects.toThrow();
		expect(read).not.toHaveBeenCalled();
	});
	it("reaches read-only live #365 evidence only after the six-version source validates", async () => {
		const source = vi.fn();
		const read = vi.fn(async (_api: unknown, _witness: RunWitness, _now: Date) => ({ commentId: 456 }));
		await inspectDispatch(resolve("."), env, event, checkout, read, new Date(), source);
		expect(source).toHaveBeenCalledWith(resolve("."), sha, tree);
		expect(read).toHaveBeenCalledWith(
			expect.objectContaining({ get: expect.any(Function) }),
			expect.objectContaining({
				runId: 12345,
				checkoutTree: tree,
			}),
			expect.any(Date),
		);
	});
});
