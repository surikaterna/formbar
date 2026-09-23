import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

export interface NpmPackFile {
	readonly mode: number;
	readonly path: string;
	readonly size: number;
}

export interface NpmPackResult {
	readonly filename: string;
	readonly files: readonly NpmPackFile[];
	readonly id: string;
	readonly name: string;
	readonly version: string;
}

function npmPackJson(packageDirectory: string, arguments_: readonly string[]): NpmPackResult {
	const output = execFileSync("npm", ["pack", ...arguments_, "--json"], {
		cwd: packageDirectory,
		encoding: "utf8",
		maxBuffer: 10 * 1024 * 1024,
	});
	const results = JSON.parse(output) as NpmPackResult[];
	if (results.length !== 1) throw new Error(`npm pack returned ${results.length} results for ${packageDirectory}`);
	return results[0];
}

export function npmPackDryRun(packageDirectory: string): NpmPackResult {
	return npmPackJson(packageDirectory, ["--dry-run"]);
}

export function npmPack(packageDirectory: string, destination: string): NpmPackResult {
	mkdirSync(destination, { recursive: true });
	return npmPackJson(packageDirectory, ["--pack-destination", destination]);
}

export function extractTarball(tarball: string, destination: string): void {
	mkdirSync(destination, { recursive: true });
	execFileSync("tar", ["-xzf", tarball, "-C", destination], { stdio: "pipe" });
}
