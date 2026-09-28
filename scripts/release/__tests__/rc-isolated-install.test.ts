import { expect, it } from "vitest";
import { withIsolatedSignedAudit } from "../rc-isolated-install";
import { verifyPrepackedSignedVersion } from "../rc-signed-existing";
import { createSignedRegistryReader } from "../rc-signed-reader";

const node = process.env.RC_SIGNED_NODE;
const npmRoot = process.env.RC_SIGNED_NPM_ROOT;

it.skipIf(!node || !npmRoot)(
	"isolates a genuine public signed exact-version install, audit and prepacked bytes",
	async () => {
		if (!node || !npmRoot) throw new Error("pinned Node/npm required");
		const approved = {
			name: "@changesets/cli",
			version: "2.29.7",
			latest: "3.0.3",
			repository: "changesets/changesets",
			workflow: ".github/workflows/changeset-version.yml",
			ref: "refs/heads/main",
			commit: "8c065c4313e06e13ce48d6681aa9a253d69f655f",
			runId: "17583250854",
			attempt: "1",
		};
		const reader = createSignedRegistryReader();
		const exact = await reader.get("https://registry.npmjs.org/%40changesets%2Fcli/2.29.7");
		const tarball = (exact.body as { dist: { tarball: string } }).dist.tarball;
		const bytes = (await reader.get(tarball, true)).bytes;
		if (!bytes) throw new Error("missing public signed tarball");
		const result = await withIsolatedSignedAudit(approved.name, approved.version, node, npmRoot, (proof) =>
			verifyPrepackedSignedVersion(reader, proof, approved, bytes),
		);
		expect(result).toMatchObject({
			status: "VERIFIED_EXISTING",
			sha512:
				"47b46a5a86a4b32c8a5db2970536d3e1111dcb6db21fcd667052bab16b6a49a9f15026d48bd51ffba6aac59b43428b88a8f75e9b65b9e827715e0b3176aec52d",
		});
	},
	120_000,
);
