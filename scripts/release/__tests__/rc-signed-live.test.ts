import { expect, it } from "vitest";
import { createPinnedAudit } from "../rc-signed-audit";
import { verifyExistingSignedVersion } from "../rc-signed-existing";
import { signerPolicy } from "../rc-signed-identity";
import { createSignedRegistryReader } from "../rc-signed-reader";

const node = process.env.RC_SIGNED_NODE;
const npmRoot = process.env.RC_SIGNED_NPM_ROOT;
const install = process.env.RC_SIGNED_INSTALL;

it.skipIf(!node || !npmRoot || !install)(
	"verifies REAL published @changesets/cli@2.29.7 signed bytes and approved run",
	async () => {
		if (!node || !npmRoot || !install) throw new Error("isolated pinned test environment required");
		const proof = await createPinnedAudit(node, npmRoot, install);
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
		const result = await verifyExistingSignedVersion(createSignedRegistryReader(), proof, approved);
		expect(result).toEqual({
			status: "VERIFIED_EXISTING",
			reason: "signed existing bytes only",
			sha512:
				"47b46a5a86a4b32c8a5db2970536d3e1111dcb6db21fcd667052bab16b6a49a9f15026d48bd51ffba6aac59b43428b88a8f75e9b65b9e827715e0b3176aec52d",
		});
		for (const wrong of [
			{ runId: "17583250855" },
			{ attempt: "2" },
			{ repository: "changesets/other" },
			{ workflow: ".github/workflows/other.yml" },
			{ ref: "refs/heads/other" },
		]) {
			expect(
				(await verifyExistingSignedVersion(createSignedRegistryReader(), proof, { ...approved, ...wrong })).status,
			).toBe("UNVERIFIABLE");
		}
		const attestation = await createSignedRegistryReader().get(
			"https://registry.npmjs.org/-/npm/v1/attestations/@changesets%2fcli@2.29.7",
		);
		const response = attestation.body as {
			attestations: Array<{
				predicateType: string;
				bundle: {
					dsseEnvelope: { signatures: Array<{ sig: string }> };
				};
			}>;
		};
		const signed = structuredClone(
			response.attestations.find((entry) => entry.predicateType === "https://slsa.dev/provenance/v1")?.bundle,
		);
		if (!signed) throw new Error("missing live signed bundle");
		signed.dsseEnvelope.signatures[0].sig = "invalid-signature";
		await expect(proof.verify(signed, signerPolicy(approved))).rejects.toThrow();
	},
	120_000,
);
