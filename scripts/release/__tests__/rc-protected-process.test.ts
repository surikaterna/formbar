import { spawn, spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const child = resolve("scripts/release/__tests__/rc-protected-child.cjs");
const directories: string[] = [];

function fixture() {
	const base = mkdtempSync(join(tmpdir(), "rc-integrated-"));
	directories.push(base);
	const temp = join(base, "work", "_temp");
	mkdirSync(temp, { recursive: true, mode: 0o700 });
	const log = join(base, "puts");
	const event = join(base, "event.json");
	writeFileSync(event, JSON.stringify({ sender: { id: 806157 }, inputs: { expected_main_sha: "a".repeat(40) } }));
	const env = {
		...process.env,
		GITHUB_TOKEN: "fake-read-only",
		GITHUB_ACTIONS: "true",
		GITHUB_JOB: "protected-rc",
		GITHUB_WORKSPACE: join(base, "work", "repo", "repo"),
		RUNNER_TEMP: temp,
		GITHUB_EVENT_PATH: event,
		GITHUB_RUN_ID: "12345",
		GITHUB_RUN_ATTEMPT: "1",
		GITHUB_ACTOR: "spralle",
		GITHUB_REPOSITORY: "surikaterna/formbar",
		GITHUB_SHA: "a".repeat(40),
		FAKE_POLICY: "true",
		PUT_LOG: log,
	};
	return { temp, log, env };
}

type Result = { status: string; reason?: string };
function run(env: NodeJS.ProcessEnv): Result {
	const result = spawnSync(process.execPath, [child], { env, encoding: "utf8" });
	expect(result.error).toBeUndefined();
	expect(result.stderr).toBe("");
	expect([0, 1]).toContain(result.status);
	return JSON.parse(result.stdout) as Result;
}
function start(env: NodeJS.ProcessEnv): Promise<Result> {
	return new Promise((done, reject) => {
		const process = spawn(globalThis.process.execPath, [child], { env });
		let output = "";
		process.stdout.on("data", (data: Buffer) => {
			output += data.toString();
		});
		process.on("error", reject);
		process.on("close", () => done(JSON.parse(output) as Result));
	});
}
function writes(log: string): string[] {
	return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
}
afterEach(() => {
	for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("#363 integrated protected adapter across Node processes (fake GH/npm only)", () => {
	it("partial/uncertain first PUT stops; a second process on the same run cannot skip or write", () => {
		const { temp, log, env } = fixture();
		expect(run(env)).toEqual({
			status: "STOPPED",
			reason: "npm publish NPM_UNKNOWN; failed or uncertain; new run required",
		});
		const claim = join(temp, "formbar-rc-12345-attempt-1.claim");
		expect(JSON.parse(readFileSync(claim, "utf8"))).toMatchObject({
			runId: 12345,
			attempt: 1,
			sha: "a".repeat(40),
			tree: "b".repeat(40),
			digest: expect.any(String),
		});
		expect(run(env)).toMatchObject({ status: "STOPPED", reason: expect.stringMatching(/EEXIST/) });
		expect(writes(log)).toEqual(["12345 @formbar/expressions"]);
		expect(existsSync(claim)).toBe(true);
	});
	it("concurrent adapters compete for one runner-local claim and only the winner attempts a PUT", async () => {
		const { log, env } = fixture();
		const results = await Promise.all([start(env), start(env)]);
		expect(results.map((result) => result.reason).sort()).toEqual(
			["npm publish NPM_UNKNOWN; failed or uncertain; new run required", expect.stringMatching(/EEXIST/)].sort(),
		);
		expect(writes(log)).toEqual(["12345 @formbar/expressions"]);
	});
	it("preexisting claim, changed SHA and unsafe or unavailable runner temp deny before PUT", () => {
		const { temp, log, env } = fixture();
		const claim = join(temp, "formbar-rc-12345-attempt-1.claim");
		writeFileSync(claim, "partial", { mode: 0o600 });
		expect(run(env).reason).toMatch(/EEXIST/);
		expect(run({ ...env, GITHUB_SHA: "b".repeat(40) }).reason).toMatch(/policy denied/);
		expect(run({ ...env, RUNNER_TEMP: "" }).status).toBe("STOPPED");
		expect(run({ ...env, RUNNER_TEMP: join(temp, "missing") }).status).toBe("STOPPED");
		rmSync(claim);
		symlinkSync(log, claim);
		expect(run(env).reason).toMatch(/EEXIST/);
		rmSync(claim);
		chmodSync(temp, 0o777);
		expect(run(env).reason).toMatch(/untrusted runner temp/);
		chmodSync(temp, 0o700);
		const alternate = join(temp, "alias");
		symlinkSync(temp, alternate);
		expect(run({ ...env, RUNNER_TEMP: alternate }).status).toBe("STOPPED");
		expect(writes(log)).toEqual([]);
	});
	it("a new run requires valid policy; failures never remove the old claim", () => {
		const { temp, log, env } = fixture();
		run(env);
		const old = join(temp, "formbar-rc-12345-attempt-1.claim");
		expect(run({ ...env, GITHUB_RUN_ID: "12346", FAKE_POLICY: "false" }).reason).toMatch(/policy denied/);
		expect(writes(log)).toHaveLength(1);
		expect(run({ ...env, GITHUB_RUN_ID: "12346" }).reason).toMatch(/new run required/);
		expect(writes(log)).toEqual(["12345 @formbar/expressions", "12346 @formbar/expressions"]);
		expect(existsSync(old)).toBe(true);
	});
});
