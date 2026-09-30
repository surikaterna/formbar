import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rcPackages, rcVersion } from "../rc-reviewed-plan";
import { approvedPreflight } from "./rc-workflow-fixture";

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
vi.mock("../rc-protected-providers", async (importActual) => ({
	...(await importActual<typeof import("../rc-protected-providers")>()),
	publishProtected: mocks.publish,
	signedPublished: mocks.signed,
}));

import { runProtectedRc } from "../rc-protected";
import { SafePublishFailure } from "../rc-protected-providers";

const sha = "a".repeat(40);
const tree = "b".repeat(40);
const run = Object.freeze({});
const originalToken = process.env.GITHUB_TOKEN;
const originalOidcUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
afterEach(() => {
	if (originalToken === undefined) process.env.GITHUB_TOKEN = undefined;
	else process.env.GITHUB_TOKEN = originalToken;
	if (originalOidcUrl === undefined) process.env.ACTIONS_ID_TOKEN_REQUEST_URL = undefined;
	else process.env.ACTIONS_ID_TOKEN_REQUEST_URL = originalOidcUrl;
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
		const fakeOidcRequests: string[] = [];
		process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://oidc.fixture.invalid/token";
		mocks.inspect.mockImplementation(async () => ({ packages: observed(published) }));
		mocks.publish.mockImplementation(async (name: string) => {
			expect(mocks.verify).toHaveBeenCalledTimes(1);
			if (published.size && mocks.signed.mock.calls.length < published.size)
				throw new Error("unsigned previous package");
			fakeOidcRequests.push(process.env.ACTIONS_ID_TOKEN_REQUEST_URL ?? "");
			published.add(name);
		});
		await expect(runProtectedRc()).resolves.toEqual({ status: "VERIFIED_SEVEN", names: candidates.map((c) => c.name) });
		expect(mocks.publish.mock.calls.map(([name]) => name)).toEqual(candidates.map((c) => c.name));
		expect(fakeOidcRequests).toEqual(Array(rcPackages.length).fill("https://oidc.fixture.invalid/token"));
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
			await expect(runProtectedRc()).rejects.toThrow("new run required");
			expect(mocks.publish).toHaveBeenCalledTimes(1);
		},
	);

	it.each(["NPM_STAGE_REQUIRED", "NPM_FORBIDDEN", "NPM_TIMEOUT", "NPM_UNKNOWN"] as const)(
		"reports safe %s after failed PUT and stops even when registry remains absent",
		async (category) => {
			mocks.inspect.mockResolvedValue({ packages: observed(new Set()) });
			mocks.publish.mockRejectedValueOnce(new SafePublishFailure(category, candidates[0].name, 400));
			await expect(runProtectedRc()).rejects.toThrow(
				`npm publish ${category} ${candidates[0].name}@${rcVersion} preflightMs=400 npmMs=0 stdoutBytes=0 stderrBytes=0; failed or uncertain; new run required`,
			);
			expect(mocks.publish).toHaveBeenCalledTimes(1);
		},
	);

	it("discards an unknown secret-bearing publish exception even if reconciliation is ambiguous", async () => {
		mocks.inspect.mockResolvedValueOnce({ packages: observed(new Set()) });
		mocks.inspect.mockResolvedValueOnce({ packages: observed(new Set()) });
		mocks.inspect.mockRejectedValue(new Error("secret registry URL"));
		mocks.publish.mockRejectedValueOnce(new Error("secret token https://user:secret@registry.invalid"));
		await expect(runProtectedRc()).rejects.toThrow("npm publish NPM_UNKNOWN; failed or uncertain; new run required");
		expect(mocks.publish).toHaveBeenCalledTimes(1);
	});

	it("existing-version skips require signed proof before any PUT", async () => {
		mocks.inspect.mockResolvedValue({ packages: observed(new Set([candidates[0].name])) });
		mocks.signed.mockRejectedValue(new Error("UNVERIFIABLE"));
		await expect(runProtectedRc()).rejects.toThrow("UNVERIFIABLE");
		expect(mocks.publish).not.toHaveBeenCalled();
	});
});

function fakeAdapterTransport(base: string, requests: string[], published: Set<string>): void {
	process.env.GITHUB_TOKEN = "fake-read-token";
	process.env.ACTIONS_ID_TOKEN_REQUEST_URL = `${base}/oidc`;
	mocks.verify.mockResolvedValue(run);
	mocks.claim.mockResolvedValue({ root: "/checkout", sha, tree, runId: 42 });
	mocks.refresh.mockResolvedValue({ root: "/checkout", sha, tree, runId: 42 });
	mocks.prepack.mockResolvedValue(candidates);
	mocks.bytes.mockResolvedValue(bytes);
	mocks.load.mockReturnValue({ initialLatest: Object.fromEntries(rcPackages.map((name) => [name, "0.22.0"])) });
	mocks.inspect.mockImplementation(async () => ({ packages: observed(published) }));
	mocks.signed.mockImplementation(async (approved, tarball, digest) => {
		expect(requests.at(-1)).toMatch(/^PUT \/npm\//);
		expect(approved).toMatchObject({ version: rcVersion, commit: sha, runId: "42", attempt: "1" });
		expect(tarball).toEqual(bytes);
		expect(digest).toBe(sha512);
	});
	mocks.publish.mockImplementation(async (name: string) => {
		expect(mocks.verify).toHaveBeenCalledTimes(1);
		const oidc = await fetch(process.env.ACTIONS_ID_TOKEN_REQUEST_URL ?? "");
		expect(oidc.ok).toBe(true);
		const result = await fetch(`${base}/npm/${encodeURIComponent(name)}`, { method: "PUT", body: bytes });
		if (!result.ok) throw new Error("403 E_STAGE_REQUIRED");
	});
}

describe("#397 preflight-to-guarded-adapter no-write transport", () => {
	it.each([0, 1, 3])("mock OIDC and npm HTTP: stop at PUT %i (0 means seven)", async (failAt) => {
		vi.resetAllMocks();
		const preflightReads = approvedPreflight();
		expect(preflightReads).toHaveLength(7);
		expect(preflightReads.some((request) => request.includes("/environments/"))).toBe(false);
		expect(preflightReads.every((request) => request.startsWith("https://api.github.com/"))).toBe(true);
		const requests: string[] = [];
		const published = new Set<string>();
		const server = createServer((request, response) => {
			const path = request.url ?? "";
			requests.push(`${request.method} ${path}`);
			if (path === "/oidc" && request.method === "GET") return void response.writeHead(200).end('{"value":"fake"}');
			if (path.startsWith("/npm/") && request.method === "PUT") {
				if (failAt && published.size + 1 === failAt) return void response.writeHead(403).end("E_STAGE_REQUIRED");
				published.add(decodeURIComponent(path.slice(5)));
				return void response.writeHead(201).end();
			}
			response.writeHead(404).end();
		});
		await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
		try {
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("missing fake HTTP address");
			const base = `http://127.0.0.1:${address.port}`;
			fakeAdapterTransport(base, requests, published);
			if (failAt) await expect(runProtectedRc()).rejects.toThrow("new run required");
			else await expect(runProtectedRc()).resolves.toMatchObject({ status: "VERIFIED_SEVEN" });
			const count = failAt || rcPackages.length;
			expect(requests.filter((request) => request.startsWith("GET /oidc"))).toHaveLength(count);
			expect(requests.filter((request) => request.startsWith("PUT /npm/"))).toHaveLength(count);
			expect(
				requests.every((request, index) =>
					index % 2 === 0 ? request === "GET /oidc" : request.startsWith("PUT /npm/"),
				),
			).toBe(true);
			expect(published.size).toBe(failAt ? failAt - 1 : 7);
			expect(mocks.signed).toHaveBeenCalledTimes(failAt ? failAt - 1 : 14);
			if (failAt) {
				mocks.claim.mockRejectedValueOnce(new Error("run already claimed"));
				await expect(runProtectedRc()).rejects.toThrow("run already claimed");
				expect(requests.filter((request) => request.startsWith("PUT /npm/"))).toHaveLength(count);
			}
		} finally {
			server.close();
		}
	});
});
