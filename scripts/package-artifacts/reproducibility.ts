import { deepStrictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { relative, resolve, sep } from "node:path";
import { type PackageAudit, auditPackages } from "./audit";

const excluded = new Set([".git", ".turbo", "dist", "node_modules", "playwright-report", "test-results", "trees"]);

function copyCleanWorkspace(root: string, destination: string): void {
	cpSync(root, destination, {
		filter(source) {
			const parts = relative(root, source).split(sep).filter(Boolean);
			return !parts.some((part) => excluded.has(part));
		},
		recursive: true,
	});
}

function runBun(root: string, arguments_: readonly string[]): void {
	try {
		execFileSync(process.execPath, arguments_, {
			cwd: root,
			env: { ...process.env, CI: "true" },
			maxBuffer: 20 * 1024 * 1024,
			stdio: "pipe",
		});
	} catch (error) {
		const failure = error as { stderr?: Buffer; stdout?: Buffer };
		process.stderr.write(failure.stdout ?? "");
		process.stderr.write(failure.stderr ?? "");
		throw error;
	}
}

function cleanBuild(source: string, destination: string): PackageAudit[] {
	copyCleanWorkspace(source, destination);
	runBun(destination, ["install", "--frozen-lockfile"]);
	runBun(destination, ["run", "build"]);
	return auditPackages(destination);
}

function compareAudits(first: readonly PackageAudit[], second: readonly PackageAudit[]): void {
	deepStrictEqual(
		first.map(({ name }) => name),
		second.map(({ name }) => name),
		"independent builds produced different package sets",
	);
	for (const [index, left] of first.entries()) {
		const right = second[index];
		deepStrictEqual(left.files, right.files, `${left.name}: independent native pack file lists differ`);
		if (!left.bytes.equals(right.bytes)) throw new Error(`${left.name}: independent native pack bytes differ`);
	}
}

export function verifyReproduciblePackages(root: string): readonly PackageAudit[] {
	const temporaryRoot = mkdtempSync(resolve(tmpdir(), "formbar-package-repro-"));
	try {
		const first = cleanBuild(root, resolve(temporaryRoot, "build-a"));
		const second = cleanBuild(root, resolve(temporaryRoot, "build-b"));
		compareAudits(first, second);
		return first;
	} finally {
		rmSync(temporaryRoot, { recursive: true, force: true });
	}
}
