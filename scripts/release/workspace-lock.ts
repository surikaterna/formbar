import { globSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { flattenDiagnosticMessageText, parseConfigFileTextToJson } from "typescript";

const dependencyFields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
type DependencyField = (typeof dependencyFields)[number];
export interface WorkspaceMetadata extends Partial<Record<DependencyField, Record<string, string>>> {
	name: string;
	version?: string;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
	optionalPeers?: string[];
}
export interface WorkspaceLock {
	lockfileVersion: number;
	workspaces: Record<string, WorkspaceMetadata>;
	packages: Record<string, unknown>;
}

export function parseWorkspaceLock(text: string): WorkspaceLock {
	const parsed = parseConfigFileTextToJson("bun.lock", text);
	if (parsed.error) throw new Error(flattenDiagnosticMessageText(parsed.error.messageText, "\n"));
	const lock = parsed.config as WorkspaceLock | undefined;
	if (
		!lock ||
		lock.lockfileVersion !== 1 ||
		!lock.workspaces ||
		typeof lock.workspaces !== "object" ||
		Array.isArray(lock.workspaces)
	)
		throw new Error("invalid Bun v1 workspace lock");
	return lock;
}

function compareWorkspace(path: string, manifest: WorkspaceMetadata, locked: WorkspaceMetadata): string[] {
	const mismatches: string[] = [];
	for (const field of ["name", "version"] as const)
		if (manifest[field] !== locked[field])
			mismatches.push(`${path || "."}:${field}: manifest=${manifest[field]} lock=${locked[field]}`);
	for (const field of dependencyFields) {
		const expected = manifest[field] ?? {};
		const actual = locked[field] ?? {};
		for (const name of new Set([...Object.keys(expected), ...Object.keys(actual)]))
			if (expected[name] !== actual[name])
				mismatches.push(`${path || "."}:${field}:${name}: manifest=${expected[name]} lock=${actual[name]}`);
	}
	const optionalPeers = Object.keys(manifest.peerDependenciesMeta ?? {})
		.filter((name) => manifest.peerDependenciesMeta?.[name].optional)
		.sort();
	if (!isDeepStrictEqual(optionalPeers, [...(locked.optionalPeers ?? [])].sort()))
		mismatches.push(`${path || "."}:optionalPeers differs`);
	return mismatches;
}

export function compareWorkspaceMetadata(manifests: Record<string, WorkspaceMetadata>, lock: WorkspaceLock): string[] {
	const mismatches: string[] = [];
	for (const path of new Set([...Object.keys(manifests), ...Object.keys(lock.workspaces)])) {
		if (!manifests[path]) mismatches.push(`${path || "."}:unexpected locked workspace`);
		else if (!lock.workspaces[path]) mismatches.push(`${path || "."}:missing locked workspace`);
		else mismatches.push(...compareWorkspace(path, manifests[path], lock.workspaces[path]));
	}
	return mismatches.sort();
}

export function readWorkspaceManifests(root: string): Record<string, WorkspaceMetadata> {
	const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as WorkspaceMetadata & {
		workspaces: string[];
	};
	if (!Array.isArray(manifest.workspaces) || manifest.workspaces.some((pattern) => typeof pattern !== "string"))
		throw new Error("workspace patterns required");
	const files = globSync(
		manifest.workspaces.map((pattern) => `${pattern}/package.json`),
		{ cwd: root },
	);
	return Object.fromEntries([
		["", manifest],
		...files.map((file) => [
			dirname(file).replaceAll("\\", "/"),
			JSON.parse(readFileSync(resolve(root, file), "utf8")) as WorkspaceMetadata,
		]),
	]);
}

export function auditWorkspaceLock(root: string) {
	const manifests = readWorkspaceManifests(root);
	const lock = parseWorkspaceLock(readFileSync(resolve(root, "bun.lock"), "utf8"));
	return { workspaces: Object.keys(manifests).length, mismatches: compareWorkspaceMetadata(manifests, lock) };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve("scripts/release/workspace-lock.ts")) {
	const report = auditWorkspaceLock(process.cwd());
	console.log(JSON.stringify(report, null, 2));
	if (report.mismatches.length) process.exitCode = 1;
}
