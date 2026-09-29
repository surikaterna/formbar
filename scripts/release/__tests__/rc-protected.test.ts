import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rcPackages, rcVersion } from "../rc-reviewed-plan";

const mocks = vi.hoisted(() => ({
	verify: vi.fn(),
	prepack: vi.fn(),
	bytes: vi.fn(),
	claim: vi.fn(),
	refresh: vi.fn(),
	load: vi.fn(),
	inspect: vi.fn(),
	publish: vi.fn(),
	signed: vi.fn(),
}));
vi.mock("../rc-run-authority", () => ({
	verifyProtectedRun: mocks.verify,
	claimVerifiedRun: mocks.claim,
	refreshVerifiedRun: mocks.refresh,
}));
vi.mock("../rc-prepacked-candidates", () => ({
	prepackProtectedRun: mocks.prepack,
	verifiedCandidateBytes: mocks.bytes,
}));
vi.mock("../rc-pack-evidence", () => ({ loadRcSource: mocks.load }));
vi.mock("../rc-live-reads", () => ({
	createRegistryGitHubReader: () => ({
		get: () => {
			throw new Error("fake transport");
		},
	}),
	inspectLiveRc: mocks.inspect,
}));
vi.mock("../rc-protected-providers", () => ({
	publishProtected: mocks.publish,
	signedPublished: mocks.signed,
}));

import { runProtectedRc } from "../rc-protected";

const sha = "a".repeat(40);
const tree = "b".repeat(40);
const run = Object.freeze({});
const originalToken = process.env.GITHUB_TOKEN;
afterEach(() => {
	if (originalToken === undefined) process.env.GITHUB_TOKEN = undefined;
	else process.env.GITHUB_TOKEN = originalToken;
});
const bytes = Buffer.from("test");
const sha512 = createHash("sha512").update(bytes).digest("hex");
const candidates = rcPackages.map((name) => ({
	name: `@formbar/${name}`,
	version: rcVersion,
	sha512,
	integrity: "sha512-7iaw3Ur350mqGo7jwQrp",
	shasum: "fake",
}));
const observed = (published: Set<string>) =>
	rcPackages.map((name) => {
		const candidate = candidates.find((item) => item.name === `@formbar/${name}`);
		if (!candidate) throw new Error("missing candidate fixture");
		return {
			name: candidate.name,
			observation: published.has(candidate.name) ? "PUBLIC_EXISTING_OBSERVED" : "PUBLIC_ABSENT_OBSERVED",
			reason: "matching metadata and downloaded bytes; signed provenance and publisher remain unverified",
			local: { integrity: candidate.integrity, shasum: candidate.shasum },
		};
	});

describe("internal protected RC adapter (mock providers are not release evidence)", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		process.env.GITHUB_TOKEN = "test-read-only";
		mocks.verify.mockResolvedValue(run);
		mocks.claim.mockResolvedValue({ root: "/checkout", sha, tree, runId: 42 });
		mocks.refresh.mockResolvedValue({ root: "/checkout", sha, tree, runId: 42 });
		mocks.prepack.mockResolvedValue(candidates);
		mocks.bytes.mockResolvedValue(bytes);
		mocks.load.mockReturnValue({ initialLatest: Object.fromEntries(rcPackages.map((name) => [name, "0.22.0"])) });
		mocks.signed.mockResolvedValue(undefined);
	});

	it("orders seven tarball PUTs; requires signed existing and prepacked verification between each", async () => {
		const published = new Set<string>();
		mocks.inspect.mockImplementation(async () => ({ packages: observed(published) }));
		mocks.publish.mockImplementation(async (name: string) => {
			if (published.size && mocks.signed.mock.calls.length < published.size)
				throw new Error("unsigned previous package");
			published.add(name);
		});
		await expect(runProtectedRc()).resolves.toEqual({ status: "VERIFIED_SEVEN", names: candidates.map((c) => c.name) });
		expect(mocks.publish.mock.calls.map(([name]) => name)).toEqual(candidates.map((c) => c.name));
		expect(mocks.signed).toHaveBeenCalledTimes(14);
	});

	it.each(["missing GO", "six-only GO", "unversioned checkout", "changed policy or tree"])(
		"denies %s before first PUT",
		async (reason) => {
			mocks.verify.mockRejectedValueOnce(new Error(reason));
			await expect(runProtectedRc()).rejects.toThrow(reason);
			expect(mocks.publish).not.toHaveBeenCalled();
		},
	);

	it("denies a six-package candidate plan before the first read or PUT", async () => {
		mocks.prepack.mockResolvedValueOnce(candidates.slice(1));
		await expect(runProtectedRc()).rejects.toThrow("unreviewed seven-package");
		expect(mocks.publish).not.toHaveBeenCalled();
	});

	it.each(["signed verifier failure", "registry redirect", "latest drift", "rc drift"])(
		"stops before the next PUT on %s",
		async (reason) => {
			const published = new Set<string>();
			mocks.inspect.mockImplementation(async () => {
				if (published.size && reason !== "signed verifier failure") throw new Error(reason);
				return { packages: observed(published) };
			});
			mocks.publish.mockImplementation(async (name: string) => {
				published.add(name);
			});
			if (reason === "signed verifier failure") mocks.signed.mockRejectedValue(new Error("UNVERIFIABLE"));
			await expect(runProtectedRc()).rejects.toThrow();
			expect(mocks.publish).toHaveBeenCalledTimes(1);
		},
	);

	it.each(["403 E_STAGE_REQUIRED", "timeout uncertain"])(
		"does not retry %s even if later reconciled",
		async (reason) => {
			const published = new Set<string>();
			mocks.inspect.mockImplementation(async () => ({ packages: observed(published) }));
			mocks.publish.mockImplementationOnce(async (name: string) => {
				published.add(name);
				throw new Error(reason);
			});
			await expect(runProtectedRc()).rejects.toThrow("new run/GO required");
			expect(mocks.publish).toHaveBeenCalledTimes(1);
		},
	);

	it("existing-version skips require signed proof before any PUT", async () => {
		mocks.inspect.mockResolvedValue({ packages: observed(new Set([candidates[0].name])) });
		mocks.signed.mockRejectedValue(new Error("UNVERIFIABLE"));
		await expect(runProtectedRc()).rejects.toThrow("UNVERIFIABLE");
		expect(mocks.publish).not.toHaveBeenCalled();
	});
});
