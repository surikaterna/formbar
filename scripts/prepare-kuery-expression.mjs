import { execFileSync } from "node:child_process";
import { access, copyFile, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../packages/expressions/node_modules/kuery/", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
if (!manifest.exports?.["./expression"]) throw new Error("Pinned Kuery expression API is unavailable.");

const declaration = join(packageRoot, "dist/expression.d.ts");
await rm(join(packageRoot, "dist"), { recursive: true, force: true });
await rm(join(packageRoot, "dist-types"), { recursive: true, force: true });
execFileSync(
	process.execPath,
	[
		join(workspaceRoot, "node_modules/typescript/bin/tsc"),
		"--declaration",
		"--emitDeclarationOnly",
		"--outDir",
		"dist-types",
		"--rootDir",
		"src",
		"--composite",
		"false",
		"--declarationMap",
		"false",
	],
	{ cwd: packageRoot, stdio: "inherit" },
);
execFileSync(
	process.execPath,
	[
		join(workspaceRoot, "node_modules/tsup/dist/cli-default.js"),
		"--entry.index",
		"src/index.ts",
		"--entry.expression",
		"src/expression/index.ts",
		"--format",
		"esm,cjs",
		"--target",
		"es2022",
		"--splitting",
		"--out-dir",
		"dist",
		"--clean",
		"--no-config",
	],
	{ cwd: packageRoot, stdio: "inherit" },
);
await copyFile(join(packageRoot, "dist-types/index.d.ts"), join(packageRoot, "dist/index.d.ts"));
await copyFile(join(packageRoot, "dist-types/expression/index.d.ts"), declaration);
for (const artifact of ["index.js", "index.cjs", "index.d.ts", "expression.js", "expression.cjs", "expression.d.ts"]) {
	await access(join(packageRoot, "dist", artifact));
	if (!(await stat(join(packageRoot, "dist", artifact))).isFile())
		throw new Error(`Missing Kuery artifact: ${artifact}`);
}
