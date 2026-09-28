/** Guard CLI identity before an injected OIDC exchange or tarball PUT. */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export async function assertPinnedPublishTools(nodeBinary: string, npmRoot: string): Promise<void> {
	const npm = JSON.parse(await readFile(join(npmRoot, "package.json"), "utf8")) as {
		name?: string;
		version?: string;
	};
	const version = await exec(nodeBinary, ["--version"], { timeout: 5_000, maxBuffer: 1024 });
	if (version.stdout.trim() !== "v22.23.2" || npm.name !== "npm" || npm.version !== "11.20.0")
		throw new Error("pinned Node/npm publish toolchain required");
}
