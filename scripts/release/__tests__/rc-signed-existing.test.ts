import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ReadOnlyTransport } from "../rc-live-reads";
import { type ApprovedVersion, type AuditProof, verifyExistingSignedVersion } from "../rc-signed-existing";

const host = "https://registry.npmjs.org";
const slsa = "https://slsa.dev/provenance/v1";
const publish = "https://github.com/npm/attestation/tree/main/specs/publish/v0.1";
const approved: ApprovedVersion = {
	name: "@changesets/cli",
	version: "2.29.7",
	repository: "changesets/changesets",
	workflow: ".github/workflows/changeset-version.yml",
	ref: "refs/heads/main",
	commit: "8c065c4313e06e13ce48d6681aa9a253d69f655f",
	runId: "17583250854",
	attempt: "1",
	latest: "3.0.3",
};
const bytes = new TextEncoder().encode("recorded @changesets/cli@2.29.7 schema; synthetic bytes, not a signed fixture");
const sha512 = createHash("sha512").update(bytes).digest("hex");

function makeBundles() {
	const subject = [{ name: "pkg:npm/%40changesets/cli@2.29.7", digest: { sha512 } }];
	const source = "https://github.com/changesets/changesets";
	const statement = (type: string) => ({
		_type: "https://in-toto.io/Statement/v1",
		subject,
		predicateType: type,
		predicate: {
			buildDefinition: {
				buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
				externalParameters: { workflow: { repository: source, path: approved.workflow, ref: approved.ref } },
				resolvedDependencies: [{ uri: `git+${source}@${approved.ref}`, digest: { gitCommit: approved.commit } }],
			},
			runDetails: {
				builder: { id: "https://github.com/actions/runner/github-hosted" },
				metadata: { invocationId: `${source}/actions/runs/${approved.runId}/attempts/1` },
			},
		},
	});
	const bundle = (type: string) => ({
		predicateType: type,
		bundle: {
			dsseEnvelope: {
				payloadType: "application/vnd.in-toto+json",
				payload: Buffer.from(JSON.stringify(statement(type))).toString("base64"),
				signatures: [{ sig: "synthetic-not-a-cryptographic-proof" }],
			},
		},
	});
	const bundles = [bundle(publish), bundle(slsa)];
	return bundles;
}

function makeFixture() {
	const bundles = makeBundles();
	const attestation = {
		url: `${host}/-/npm/v1/attestations/@changesets%2fcli@2.29.7`,
		provenance: { predicateType: slsa },
	};
	const dist = {
		integrity: `sha512-${Buffer.from(sha512, "hex").toString("base64")}`,
		shasum: createHash("sha1").update(bytes).digest("hex"),
		tarball: `${host}/@changesets/cli/-/cli-2.29.7.tgz`,
		attestations: attestation,
	};
	const metadata = { name: approved.name, version: approved.version, gitHead: approved.commit, dist };
	const pack = {
		name: approved.name,
		versions: { [approved.version]: metadata },
		"dist-tags": { latest: approved.latest },
	};
	const report = {
		invalid: new Array<unknown>(),
		missing: new Array<unknown>(),
		verified: [
			{
				name: approved.name,
				version: approved.version,
				location: "node_modules/@changesets/cli",
				registry: `${host}/`,
				attestations: attestation,
				attestationBundles: bundles,
			},
		],
	};
	const replies: Record<string, { status: number; body?: unknown; bytes?: Uint8Array; location?: string }> = {
		[`${host}/${encodeURIComponent(approved.name)}/${approved.version}`]: { status: 200, body: metadata },
		[`${host}/${encodeURIComponent(approved.name)}`]: { status: 200, body: pack },
		[dist.tarball]: { status: 200, bytes },
		[attestation.url]: { status: 200, body: { attestations: bundles } },
	};
	return { replies, report, bundles, metadata, pack, dist };
}

function setup() {
	const { replies, report, bundles, metadata, pack, dist } = makeFixture();
	let verifies = 0;
	const read: ReadOnlyTransport = { get: async (url) => replies[url] ?? { status: 404 } };
	const proof: AuditProof = {
		audit: async () => ({ version: "11.20.0", exit: 0, json: report }),
		verify: async (_bundle, policy) => {
			verifies++;
			expect(policy.certificateIssuer).toBe("https://token.actions.githubusercontent.com");
			expect(policy.certificateOIDs["1.3.6.1.4.1.57264.1.21"].toString()).toContain("/runs/17583250854/attempts/1");
		},
	};
	return {
		read,
		proof,
		replies,
		report,
		bundles,
		metadata,
		pack,
		dist,
		get verifies() {
			return verifies;
		},
	};
}

describe("#374 disabled existing-version verifier (synthetic transport; live proof uses pinned Sigstore)", () => {
	it("requires all fields even with a cooperating injected trust verifier", async () => {
		const f = setup();
		expect(await verifyExistingSignedVersion(f.read, f.proof, approved)).toEqual({
			status: "VERIFIED_EXISTING",
			reason: "signed existing bytes only",
			sha512,
		});
		expect(f.verifies).toBe(1);
	});
	it.each([
		[
			"absent future version",
			(f: ReturnType<typeof setup>) => {
				f.replies[`${host}/${encodeURIComponent(approved.name)}/${approved.version}`].status = 404;
			},
		],
		[
			"unsigned",
			(f: ReturnType<typeof setup>) => {
				(f.dist as Partial<typeof f.dist>).attestations = undefined;
			},
		],
		[
			"forged dist.provenance alone, without a signed attestation",
			(f: ReturnType<typeof setup>) => {
				(f.dist as Record<string, unknown>).provenance = {
					repository: approved.repository,
					workflow: approved.workflow,
					commit: approved.commit,
					runId: approved.runId,
				};
				(f.dist as Partial<typeof f.dist>).attestations = undefined;
			},
		],
		[
			"wrong downloaded bytes",
			(f: ReturnType<typeof setup>) => {
				f.replies[f.dist.tarball].bytes = new Uint8Array([1]);
			},
		],
		[
			"foreign tarball",
			(f: ReturnType<typeof setup>) => {
				f.dist.tarball = "https://evil.example/package.tgz";
			},
		],
		[
			"tarball redirect",
			(f: ReturnType<typeof setup>) => {
				f.replies[f.dist.tarball] = { status: 302, location: "https://evil.example/package.tgz" };
			},
		],
		[
			"foreign attestation URL",
			(f: ReturnType<typeof setup>) => {
				f.dist.attestations.url = "https://evil.example/attestations";
			},
		],
		[
			"attestation redirect",
			(f: ReturnType<typeof setup>) => {
				f.replies[f.dist.attestations.url] = { status: 302, location: "https://evil.example/attestations" };
			},
		],
		[
			"changed latest",
			(f: ReturnType<typeof setup>) => {
				f.pack["dist-tags"].latest = "9.0.0";
			},
		],
		[
			"duplicate bundle",
			(f: ReturnType<typeof setup>) => {
				f.bundles.push(f.bundles[1]);
			},
		],
		[
			"foreign subject",
			(f: ReturnType<typeof setup>) => {
				f.bundles[1].bundle.dsseEnvelope.payload = Buffer.from(
					JSON.stringify({
						...JSON.parse(Buffer.from(f.bundles[1].bundle.dsseEnvelope.payload, "base64").toString()),
						subject: [{ name: "pkg:npm/evil@1.0.0", digest: { sha512 } }],
					}),
				).toString("base64");
			},
		],
		[
			"invalid audit",
			(f: ReturnType<typeof setup>) => {
				f.report.invalid.push({ code: "EATTESTATIONVERIFY" });
			},
		],
		[
			"unverified extra bundle in audit response",
			(f: ReturnType<typeof setup>) => {
				f.report.verified[0].attestationBundles = [];
			},
		],
		[
			"foreign installed target location",
			(f: ReturnType<typeof setup>) => {
				f.report.verified[0].location = "node_modules/other";
			},
		],
		[
			"wrong signed SHA512",
			(f: ReturnType<typeof setup>) => {
				f.bundles[1].bundle.dsseEnvelope.payload = Buffer.from(
					JSON.stringify({
						...JSON.parse(Buffer.from(f.bundles[1].bundle.dsseEnvelope.payload, "base64").toString()),
						subject: [{ name: "pkg:npm/%40changesets/cli@2.29.7", digest: { sha512: "0".repeat(128) } }],
					}),
				).toString("base64");
			},
		],
		[
			"missing signed run",
			(f: ReturnType<typeof setup>) => {
				f.bundles[1].bundle.dsseEnvelope.payload = Buffer.from(
					JSON.stringify({
						...JSON.parse(Buffer.from(f.bundles[1].bundle.dsseEnvelope.payload, "base64").toString()),
						predicate: { buildDefinition: { externalParameters: {}, resolvedDependencies: [] } },
					}),
				).toString("base64");
			},
		],
	] as const)("denies %s", async (_name, mutate) => {
		const f = setup();
		mutate(f);
		expect((await verifyExistingSignedVersion(f.read, f.proof, approved)).status).toBe("UNVERIFIABLE");
	});
	it("never consults proof for metadata-only provenance or foreign attestation", async () => {
		for (const url of [undefined, "https://evil.example/attestations"]) {
			const f = setup();
			(f.dist as Record<string, unknown>).provenance = { commit: approved.commit };
			if (url) f.dist.attestations.url = url;
			else (f.dist as Partial<typeof f.dist>).attestations = undefined;
			expect((await verifyExistingSignedVersion(f.read, f.proof, approved)).status).toBe("UNVERIFIABLE");
			expect(f.verifies).toBe(0);
		}
	});
	it.each([401, 403, 429, 500, 502, 503])("denies registry %i at each read without invoking proof", async (status) => {
		for (const url of [
			`${host}/${encodeURIComponent(approved.name)}/${approved.version}`,
			`${host}/${encodeURIComponent(approved.name)}`,
			`${host}/@changesets/cli/-/cli-2.29.7.tgz`,
			`${host}/-/npm/v1/attestations/@changesets%2fcli@2.29.7`,
		]) {
			const f = setup();
			f.replies[url] = { status };
			expect((await verifyExistingSignedVersion(f.read, f.proof, approved)).status).toBe("UNVERIFIABLE");
			expect(f.verifies).toBe(0);
		}
	});
	it("denies redirects on every registry read, without following foreign locations", async () => {
		for (const url of [
			`${host}/${encodeURIComponent(approved.name)}/${approved.version}`,
			`${host}/${encodeURIComponent(approved.name)}`,
			`${host}/@changesets/cli/-/cli-2.29.7.tgz`,
			`${host}/-/npm/v1/attestations/@changesets%2fcli@2.29.7`,
		]) {
			const f = setup();
			const requests: string[] = [];
			f.replies[url] = { status: 302, location: "https://evil.example/redirected" };
			const original = f.read.get;
			f.read.get = async (requested, binary) => {
				requests.push(requested);
				return original(requested, binary);
			};
			expect((await verifyExistingSignedVersion(f.read, f.proof, approved)).status).toBe("UNVERIFIABLE");
			expect(requests).not.toContain("https://evil.example/redirected");
			expect(f.verifies).toBe(0);
		}
	});
	it("denies incorrect expected run and a rejected signer", async () => {
		const f = setup();
		expect((await verifyExistingSignedVersion(f.read, f.proof, { ...approved, attempt: "2" })).status).toBe(
			"UNVERIFIABLE",
		);
		f.proof.verify = async () => {
			throw new Error("rejected signing certificate");
		};
		expect((await verifyExistingSignedVersion(f.read, f.proof, approved)).status).toBe("UNVERIFIABLE");
	});
	it("denies rc/latest movement between fresh reads", async () => {
		const f = setup();
		const initial = f.read.get;
		let packReads = 0;
		f.read.get = async (url, binary) => {
			if (url === `${host}/${encodeURIComponent(approved.name)}` && ++packReads === 2)
				f.pack["dist-tags"].latest = "4.0.0";
			return initial(url, binary);
		};
		expect((await verifyExistingSignedVersion(f.read, f.proof, approved)).status).toBe("UNVERIFIABLE");
	});
});
