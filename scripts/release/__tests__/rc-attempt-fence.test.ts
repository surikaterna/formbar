import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Separate actual Node processes, actual O_EXCL and fsync; only PUT is represented by a test marker.
const hook = `require.extensions['.ts'] = (module, filename) => {
 const ts = require('typescript');
 const fs = require('node:fs');
 module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
 }).outputText, filename);
};
if (process.env.FAULT_FSYNC === 'true') require('node:fs').fsyncSync = () => { throw Error('fsync failed'); };
const { claimAttempt } = require(${JSON.stringify(resolve("scripts/release/rc-attempt-fence.ts"))});
try {
 claimAttempt(Number(process.env.GITHUB_RUN_ID), 'a'.repeat(40), 'b'.repeat(40), process.env.PLAN_DIGEST);
 require('node:fs').appendFileSync(process.env.PUT_MARKER, 'PUT\\n');
 process.exit(0);
} catch { process.exit(1); }`;
const dirs: string[] = [];
function fixture() {
	const base = mkdtempSync(join(tmpdir(), "rc-fence-"));
	dirs.push(base);
	const work = join(base, "work");
	const temp = join(work, "_temp");
	mkdirSync(temp, { recursive: true, mode: 0o700 });
	const marker = join(base, "puts");
	const env = {
		...process.env,
		GITHUB_ACTIONS: "true",
		GITHUB_JOB: "protected-rc",
		GITHUB_WORKSPACE: join(work, "repo", "repo"),
		RUNNER_TEMP: temp,
		GITHUB_RUN_ID: "12345",
		GITHUB_RUN_ATTEMPT: "1",
		PLAN_DIGEST: "c".repeat(64),
		PUT_MARKER: marker,
	};
	return { temp, marker, env };
}
function run(env: NodeJS.ProcessEnv) {
	return spawnSync(process.execPath, ["-e", hook], { env, encoding: "utf8" }).status;
}
function start(env: NodeJS.ProcessEnv) {
	return new Promise<number | null>((done) => {
		const child = spawn(process.execPath, ["-e", hook], { env });
		child.on("exit", done);
	});
}
function count(marker: string) {
	return existsSync(marker) ? readFileSync(marker, "utf8").split("PUT\n").length - 1 : 0;
}
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("#363 runner-local durable attempt fence", () => {
	it("two Node processes race: exactly one PUT; restart cannot resume a partial PUT", async () => {
		const { env, marker } = fixture();
		expect((await Promise.all([start(env), start(env)])).sort()).toEqual([0, 1]);
		expect(count(marker)).toBe(1);
		expect(run(env)).toBe(1);
		expect(count(marker)).toBe(1);
	});
	it("timeout/crash retains claim; only a different authenticated run lane can proceed", () => {
		const { env, marker } = fixture();
		expect(run(env)).toBe(0);
		expect(run({ ...env, PLAN_DIGEST: "d".repeat(64) })).toBe(1);
		expect(run({ ...env, GITHUB_RUN_ID: "12346" })).toBe(0);
		expect(count(marker)).toBe(2);
	});
	it("precreated symlink, garbage and unsafe runtime paths refuse to PUT", () => {
		const { temp, env, marker } = fixture();
		const claim = join(temp, "formbar-rc-12345-attempt-1.claim");
		symlinkSync(marker, claim);
		expect(run(env)).toBe(1);
		rmSync(claim);
		writeFileSync(claim, "partial", { mode: 0o600 });
		expect(run(env)).toBe(1);
		expect(run({ ...env, RUNNER_TEMP: tmpdir() })).toBe(1);
		expect(run({ ...env, GITHUB_JOB: "other" })).toBe(1);
		expect(run({ ...env, GITHUB_RUN_ATTEMPT: "2", GITHUB_RUN_ID: "12346" })).toBe(1);
		expect(run({ ...env, RUNNER_TEMP: "" })).toBe(1);
		expect(count(marker)).toBe(0);
	});
	it("failed fsync leaves a permanent claim and denies a later process", () => {
		const { temp, env, marker } = fixture();
		expect(run({ ...env, FAULT_FSYNC: "true" })).toBe(1);
		expect(existsSync(join(temp, "formbar-rc-12345-attempt-1.claim"))).toBe(true);
		expect(run(env)).toBe(1);
		expect(count(marker)).toBe(0);
	});
});
