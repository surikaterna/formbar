import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createPinnedAudit } from "../rc-signed-audit";
import { verifyExistingSignedVersion, verifyPrepackedSignedVersion } from "../rc-signed-existing";
import { signerPolicy } from "../rc-signed-identity";
import { createSignedRegistryReader } from "../rc-signed-reader";

const node = process.env.RC_SIGNED_NODE;
const npmRoot = process.env.RC_SIGNED_NPM_ROOT;
const install = process.env.RC_SIGNED_INSTALL;

async function verifySigningTimeBoundary(root: string, signed: unknown) {
	const requirePinned = createRequire(join(root, "package.json"));
	const { bundleFromJSON } = requirePinned("@sigstore/bundle");
	const { toSignedEntity, toTrustMaterial } = requirePinned("@sigstore/verify");
	const { getTrustedRoot } = requirePinned("@sigstore/tuf");
	const { verifyCertificateChain } = requirePinned(join(root, "node_modules/@sigstore/verify/dist/key/certificate.js"));
	const bundle = bundleFromJSON(signed);
	const entity = toSignedEntity(bundle);
	if (entity.key.$case !== "certificate") throw new Error("expected real Fulcio leaf certificate");
	const leaf = entity.key.certificate;
	const trust = toTrustMaterial(await getTrustedRoot());
	const signingTime = new Date(Number(bundle.verificationMaterial.tlogEntries[0].integratedTime) * 1000);
	const authority = trust.certificateAuthorities.filter(
		(ca: { validFor: { start: Date; end: Date } }) =>
			ca.validFor.start <= signingTime && signingTime <= ca.validFor.end,
	);
	// Keep the genuine trusted chain but isolate leaf validity: a timestamp just
	// after its expiry cannot be a valid signing time, even though the chain signs correctly.
	const leafExpiredTime = new Date(leaf.notAfter.getTime() + 1000);
	const validChain = verifyCertificateChain(signingTime, leaf, authority);
	if (validChain[0].notAfter.getTime() !== leaf.notAfter.getTime()) throw new Error("wrong leaf");
	const isolated = authority.map((ca: { certChain: unknown[]; validFor: { start: Date; end: Date } }) => ({
		...ca,
		validFor: {
			start: ca.validFor.start,
			end: new Date(Math.max(ca.validFor.end.getTime(), leafExpiredTime.getTime())),
		},
	}));
	try {
		verifyCertificateChain(leafExpiredTime, leaf, isolated);
		throw new Error("expired leaf accepted");
	} catch (error) {
		expect((error as { cause?: Error }).cause?.message).toBe(
			"certificate is not valid or expired at the specified date",
		);
	}
}

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
		const registry = createSignedRegistryReader();
		const exact = await registry.get("https://registry.npmjs.org/%40changesets%2Fcli/2.29.7");
		const tarball = (exact.body as { dist: { tarball: string } }).dist.tarball;
		const bytes = (await registry.get(tarball, true)).bytes;
		if (!bytes) throw new Error("missing real public tarball");
		expect((await verifyPrepackedSignedVersion(registry, proof, approved, bytes)).status).toBe("VERIFIED_EXISTING");
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
		await verifySigningTimeBoundary(npmRoot, signed);
		signed.dsseEnvelope.signatures[0].sig = "invalid-signature";
		await expect(proof.verify(signed, signerPolicy(approved))).rejects.toThrow();
	},
	120_000,
);
