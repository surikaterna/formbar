import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), "formbar-tui-packed-"));

try {
	const report = JSON.parse(
		execFileSync("npm", ["pack", "--json", "--pack-destination", temporary], {
			cwd: packageRoot,
			encoding: "utf8",
		}),
	);
	assert.equal(report.length, 1);
	const consumer = join(temporary, "consumer");
	const scope = join(consumer, "node_modules", "@formbar");
	await mkdir(scope, { recursive: true });
	execFileSync("tar", ["-xzf", join(temporary, report[0].filename)], { cwd: temporary });
	await rename(join(temporary, "package"), join(scope, "tui"));
	for (const dependency of ["core", "from-schema"]) {
		await symlink(join(workspaceRoot, "packages", dependency), join(scope, dependency), "dir");
	}
	for (const dependency of ["ink", "react"]) {
		await symlink(join(workspaceRoot, "node_modules", dependency), join(consumer, "node_modules", dependency), "dir");
	}
	await writeFile(join(consumer, "package.json"), JSON.stringify({ type: "module" }));
	await writeFile(
		join(consumer, "index.mjs"),
		[
			'import * as root from "@formbar/tui";',
			'import * as standalone from "@formbar/tui/standalone";',
			'if (Object.keys(root).length !== 7) throw new Error("root export mismatch");',
			'if (Object.keys(standalone).sort().join(",") !== "normalizeStandaloneInput,renderStandaloneForm") throw new Error("standalone export mismatch");',
		].join("\n"),
	);
	execFileSync(process.execPath, ["index.mjs"], { cwd: consumer, stdio: "inherit" });
	const manifest = JSON.parse(await readFile(join(scope, "tui", "package.json"), "utf8"));
	assert.equal(manifest.private, true);
	console.log("packed ESM consumer: root and standalone imports passed");
} finally {
	await rm(temporary, { recursive: true, force: true });
}
