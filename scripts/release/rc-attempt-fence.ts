/** Runner-local only: local filesystem must honor exclusive create and fsync (not NFS/shared mounts).
 * A first-attempt job moved to a different host is NOT fenced here; keep dispatch disabled until
 * cross-host recovery semantics are established or a separately audited durable CAS exists.
 */
import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, fsyncSync, lstatSync, openSync, realpathSync, writeSync } from "node:fs";
import { dirname, isAbsolute, join, normalize } from "node:path";

export function claimAttempt(runId: number, sha: string, tree: string, digest: string): void {
	const temp = process.env.RUNNER_TEMP;
	const workspace = process.env.GITHUB_WORKSPACE;
	if (
		process.env.GITHUB_ACTIONS !== "true" ||
		process.env.GITHUB_JOB !== "protected-rc" ||
		process.env.GITHUB_RUN_ATTEMPT !== "1" ||
		!Number.isSafeInteger(runId) ||
		runId <= 0 ||
		String(runId) !== process.env.GITHUB_RUN_ID ||
		![sha, tree].every((value) => /^[0-9a-f]{40}$/.test(value)) ||
		!/^[0-9a-f]{64}$/.test(digest) ||
		!temp ||
		!workspace ||
		!isAbsolute(workspace) ||
		!isAbsolute(temp) ||
		normalize(temp) !== temp ||
		normalize(workspace) !== workspace ||
		temp !== join(dirname(dirname(workspace)), "_temp")
	)
		throw new Error("untrusted protected runner fence identity");
	const stat = lstatSync(temp);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		stat.uid !== process.getuid?.() ||
		(stat.mode & 0o022) !== 0 ||
		realpathSync(temp) !== temp
	)
		throw new Error("untrusted runner temp directory");
	// Filename intentionally excludes plan/checkout: changed evidence must not open a second lane for this run.
	const path = join(temp, `formbar-rc-${runId}-attempt-1.claim`);
	const record = `${JSON.stringify({ runId, attempt: 1, job: "protected-rc", sha, tree, digest })}\n`;
	const bytes = Buffer.from(record);
	if (bytes.length > 512) throw new Error("oversized attempt claim");
	const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
	let file: number | undefined;
	try {
		file = openSync(path, flags, 0o600);
		if (fstatSync(file).mode & 0o077) throw new Error("insecure attempt claim");
		let offset = 0;
		while (offset < bytes.length) {
			const written = writeSync(file, bytes, offset, bytes.length - offset);
			if (written <= 0) throw new Error("attempt claim write stalled");
			offset += written;
		}
		fsyncSync(file);
	} finally {
		if (file !== undefined) closeSync(file);
	}
	const directory = openSync(temp, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
	try {
		fsyncSync(directory);
	} finally {
		closeSync(directory);
	}
	// No unlink on any error or successful exit. Preexisting claims are never read or resumed.
}

export function planDigest(plan: unknown): string {
	return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}
