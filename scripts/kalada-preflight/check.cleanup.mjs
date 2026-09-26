import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("failure after mkdtemp removes only this run's directory", () => {
	const parent = mkdtempSync(resolve(tmpdir(), "formbar-302-cleanup-test-"));
	const sentinel = resolve(parent, "formbar-302-kalada-other-run");
	try {
		mkdirSync(sentinel);
		const result = spawnSync(process.execPath, [fileURLToPath(new URL("./check.mjs", import.meta.url))], {
			env: {
				...process.env,
				TMPDIR: parent,
				KALADA_REPO: parent,
				KALADA_PUBLISHED_050_TARBALL: resolve(parent, "external-published.tgz"),
				KALADA_PREFLIGHT_FAIL_AFTER_MKDTEMP: "1",
			},
			encoding: "utf8",
		});
		assert.equal(result.status, 1, result.stderr);
		assert.match(result.stderr, /preflight cleanup test failure/);
		assert.equal(existsSync(sentinel), true);
		assert.deepEqual(readdirSync(parent), ["formbar-302-kalada-other-run"]);
	} finally {
		rmSync(parent, { recursive: true, force: true });
	}
});
