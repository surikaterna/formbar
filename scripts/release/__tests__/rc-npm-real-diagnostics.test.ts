import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { npmDiagnostics } from "../rc-npm-diagnostics";

const node = process.env.NPM_DIAGNOSTIC_NODE;
const npm = process.env.NPM_DIAGNOSTIC_ROOT;

function probe(dir: string, collision: boolean, json: boolean) {
	const args = [
		join(npm as string, "bin/npm-cli.js"),
		"config",
		"not-a-command",
		"--offline",
		"--logs-max=0",
		"--userconfig=/dev/null",
		`--globalconfig=${collision ? "/dev/null" : join(dir, "absent-globalconfig")}`,
		...(json ? ["--json"] : []),
	];
	return spawnSync(node as string, args, {
		cwd: dir,
		env: { HOME: dir, TMPDIR: dir, PATH: "", NO_COLOR: "1" },
		encoding: "utf8",
		timeout: 10_000,
		maxBuffer: 100_000,
	});
}

it.skipIf(!node || !npm).each([
	[false, false],
	[false, true],
	[true, false],
	[true, true],
])("#437 actual Node22.23.2/npm11.20.0 offline collision=%s json=%s", (collision, json) => {
	expect(spawnSync(node as string, ["--version"], { encoding: "utf8" }).stdout.trim()).toBe("v22.23.2");
	expect(JSON.parse(readFileSync(join(npm as string, "package.json"), "utf8")).version).toBe("11.20.0");
	const dir = mkdtempSync(join(tmpdir(), "rc-npm-offline-"));
	try {
		const result = probe(dir, collision, json);
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(1);
		expect(result.signal).toBeNull();
		const diagnostic = npmDiagnostics(
			{ code: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr },
			[],
		);
		expect(diagnostic).toContain("suppression=none");
		expect(diagnostic).toContain(collision ? "double-loading config" : "npm error");
		expect(diagnostic).toContain(collision ? "npmCode=unavailable" : "npmCode=EUSAGE");
		expect(Buffer.byteLength(diagnostic)).toBeLessThan(1800);
		if (json && !collision) expect(JSON.parse(result.stdout).error.summary).toContain("\n");
		else expect(result.stdout).toBe("");
		expect(readdirSync(dir)).not.toContain(".npmrc");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
