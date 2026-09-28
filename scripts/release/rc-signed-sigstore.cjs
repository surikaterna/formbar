// Run the pinned npm Sigstore verifier in Node, not Bun's crypto/TUF runtime.
const { createRequire } = require("node:module");

async function main() {
	const [npmRoot, bundle64, policy64] = process.argv.slice(2);
	const bundle = JSON.parse(Buffer.from(bundle64, "base64").toString("utf8"));
	const policy = JSON.parse(Buffer.from(policy64, "base64").toString("utf8"));
	for (const [oid, bytes] of Object.entries(policy.certificateOIDs)) {
		policy.certificateOIDs[oid] = Buffer.from(bytes, "base64");
	}
	const sigstore = createRequire(`${npmRoot}/package.json`)("sigstore");
	await sigstore.verify(bundle, { ...policy, tlogThreshold: 1, ctLogThreshold: 1 });
}

main().catch(() => {
	process.exitCode = 1;
});
