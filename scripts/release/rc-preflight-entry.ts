/** Bundle with pinned Bun at review time; execute under runner Node without installing dependencies. */
import { verifyProtectedRun } from "./rc-run-authority";

async function main(): Promise<void> {
	const token = process.env.GITHUB_TOKEN;
	if (!token) throw new Error("read-only GitHub credential required");
	await verifyProtectedRun(process.cwd(), token);
}

main().catch((error: unknown) => {
	console.error("RC preflight DENIED:", error);
	process.exitCode = 1;
});
