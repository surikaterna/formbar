import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runBaselineTest } from "./baseline-test.mjs";
import { startRegistry } from "./local-registry.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("baseline unfiltered failures cannot pass the overlay", () => {
	const runner = (status) => (lane, command, args) => {
		assert.equal(lane, "baseline-unfiltered");
		assert.equal(command, "bun");
		assert.deepEqual(args, ["run", "test"]);
		return status;
	};
	assert.doesNotThrow(() => runBaselineTest(runner(0)));
	assert.throws(() => runBaselineTest(runner(1)), /baseline unfiltered bun run test failed/);
	assert.throws(() => runBaselineTest(runner(null)), /baseline unfiltered bun run test failed/);
});

test("pre-snapshot injected failure removes only the run-owned temp", () => {
	const staging = join(root, "dist/kalada-preflight");
	assert.match(
		spawnSync("git", ["check-ignore", "-v", "dist/kalada-preflight/probe"], {
			cwd: root,
			encoding: "utf8",
		}).stdout,
		/^\.gitignore:2:dist\/\s/,
	);
	mkdirSync(staging, { recursive: true });
	const sentinel = join(staging, "unrelated-run-sentinel");
	assert.equal(existsSync(sentinel), false);
	writeFileSync(sentinel, "keep");
	const names = () =>
		new Set(
			(existsSync(staging) ? readdirSync(staging) : []).filter((name) => name.startsWith("formbar-316-overlay-")),
		);
	const paths = ["package.json", "packages/declarative/package.json", "bun.lock"];
	const before = paths.map((path) => readFileSync(join(root, path)));
	const temps = names();
	assert.equal(existsSync(join(root, ".npmrc")), false);
	try {
		const result = spawnSync(process.execPath, ["scripts/kalada-preflight/overlay.mjs"], {
			cwd: root,
			env: { ...process.env, KALADA_316_FAIL_AFTER_MKDTEMP: "1" },
			encoding: "utf8",
		});
		const { runTemp } = JSON.parse(result.stdout.split("\n").find((line) => line.includes('"runTemp"')));
		assert.equal(runTemp.startsWith(`${realpathSync(staging)}/formbar-316-overlay-`), true);
		assert.equal(isAbsolute(runTemp), true);
		assert.equal(relative(root, runTemp).startsWith("dist/kalada-preflight/"), true);
		assert.equal(runTemp.includes("node_modules"), false);
		assert.equal(runTemp.startsWith("/tmp/"), false);
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /overlay cleanup test failure/);
		assert.equal(existsSync(runTemp), false);
		assert.deepEqual(names(), temps);
		assert.equal(readFileSync(sentinel, "utf8"), "keep");
		assert.equal(existsSync(join(root, ".npmrc")), false);
		for (const [index, path] of paths.entries()) assert.deepEqual(readFileSync(join(root, path)), before[index]);
	} finally {
		rmSync(sentinel);
	}
});

test("loopback registry serves only GETs for exact artifacts", async () => {
	const bytes = Buffer.from("pinned archive bytes");
	const requests = [];
	const registry = await startRegistry(
		[
			{
				name: "core",
				version: "0.6.0",
				bytes,
				integrity: "sha512-pinned",
				manifest: { name: "@kalada/core", version: "0.6.0" },
			},
		],
		requests,
	);
	try {
		const metadata = await fetch(new URL("@kalada%2fcore", registry.url));
		assert.equal(metadata.status, 200);
		assert.deepEqual(Object.keys((await metadata.json()).versions), ["0.6.0"]);
		const archive = "@kalada/core/-/core-0.6.0.tgz";
		const response = await fetch(new URL(archive, registry.url));
		assert.equal(response.status, 200);
		assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
		for (const method of ["HEAD", "POST"]) {
			assert.equal((await fetch(new URL(archive, registry.url), { method })).status, 405);
		}
		for (const path of ["@kalada/other", "@kalada/core/-/core-0.5.0.tgz"]) {
			assert.equal((await fetch(new URL(path, registry.url))).status, 404);
		}
		assert.deepEqual(
			requests.map(({ status }) => status),
			[200, 200, 405, 405, 404, 404],
		);
	} finally {
		await registry.close();
	}
});
