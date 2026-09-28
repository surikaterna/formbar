import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type ReadReply, createRegistryGitHubReader, inspectLiveRc } from "../rc-live-reads";
import type { SourceWitness } from "../rc-registry-proof";
import { consumed } from "../rc-source-check";

const names = ["arbiter", "core", "declarative", "from-schema", "react", "react-schema"];
const version = "0.23.0-rc.0";
const commit = "a".repeat(40);
const tree = "b".repeat(40);
const bytes = new TextEncoder().encode("fixed npm pack fixture");
const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
const shasum = createHash("sha1").update(bytes).digest("hex");
const root = "https://registry.npmjs.org";
const gh = "https://api.github.com/repos/surikaterna/formbar";
const edges: Record<string, string[]> = {
	arbiter: ["core"],
	core: [],
	declarative: ["core"],
	"from-schema": ["core", "declarative"],
	react: ["core"],
	"react-schema": ["core", "declarative", "from-schema", "react"],
};

function fixture() {
	const source: SourceWitness = {
		commit,
		tree,
		pre: { mode: "pre", tag: "rc", changesets: consumed, initialVersions: { "@formbar/expressions": "0.14.3" } },
		manifests: { expressions: { name: "@formbar/expressions", version: "0.14.3" } },
		changelogs: {},
		artifacts: {},
		initialLatest: {},
	};
	const replies = new Map<string, ReadReply>();
	const calls: string[] = [];
	replies.set(`${gh}/commits/${commit}`, { status: 200, body: { commit: { tree: { sha: tree } } } });
	for (const name of names) {
		const pkg = `@formbar/${name}`;
		const encoded = encodeURIComponent(pkg);
		source.manifests[name] = {
			name: pkg,
			version,
			dependencies: Object.fromEntries(edges[name].map((edge) => [`@formbar/${edge}`, `^${version}`])),
		};
		source.changelogs[name] = `## ${version}\n\nNotes for ${name}`;
		source.initialLatest[name] = "0.22.0";
		replies.set(`${root}/${encoded}/${version}`, { status: 404 });
		replies.set(`${root}/${encoded}`, {
			status: 200,
			body: { name: pkg, versions: {}, "dist-tags": { latest: "0.22.0" } },
		});
		const tag = encodeURIComponent(`${pkg}@${version}`);
		replies.set(`${gh}/git/ref/tags/${tag}`, { status: 404 });
		replies.set(`${gh}/releases/tags/${tag}`, { status: 404 });
	}
	function published(name: string) {
		const pkg = `@formbar/${name}`;
		const encoded = encodeURIComponent(pkg);
		const tarball = `${root}/@formbar/${name}/-/${name}-${version}.tgz`;
		const metadata = { name: pkg, version, gitHead: commit, dist: { integrity, shasum, tarball } };
		replies.set(`${root}/${encoded}/${version}`, { status: 200, body: metadata });
		replies.set(`${root}/${encoded}`, {
			status: 200,
			body: { name: pkg, versions: { [version]: metadata }, "dist-tags": { latest: "0.22.0", rc: version } },
		});
		replies.set(tarball, { status: 200, bytes });
		return { metadata, tarball };
	}
	const read = {
		get: async (url: string) => {
			calls.push(url);
			return replies.get(url) ?? { status: 403 };
		},
	};
	const pack = { pack: async (_name: string, _attempt: 1 | 2) => bytes };
	return { source, replies, calls, read, pack, published };
}

describe("#371 GET-only evidence (sanitized fixtures)", () => {
	it("never upgrades corroborated 404, all existing or mixed reads to release authority", async () => {
		const f = fixture();
		const absent = await inspectLiveRc(f.read, f.pack, f.source);
		expect(absent.packages).toHaveLength(6);
		expect(
			absent.packages.every((p) => p.observation === "PUBLIC_ABSENT_OBSERVED" && p.reason.includes("authorization")),
		).toBe(true);
		expect(absent.decision).toBe("UNVERIFIABLE");
		expect(absent.packages[0]?.gets).toEqual(
			expect.arrayContaining([
				{ url: `${root}/${encodeURIComponent("@formbar/arbiter")}/${version}`, status: 404 },
				{ url: `${gh}/releases/tags/${encodeURIComponent(`@formbar/arbiter@${version}`)}`, status: 404 },
			]),
		);
		for (const name of names) f.published(name);
		const existing = await inspectLiveRc(f.read, f.pack, f.source);
		expect(
			existing.packages.every((p) => p.observation === "PUBLIC_EXISTING_OBSERVED" && p.local?.shasum === shasum),
		).toBe(true);
		expect(existing.decision).toBe("UNVERIFIABLE");
		f.replies.set(`${root}/${encodeURIComponent("@formbar/core")}/${version}`, { status: 404 });
		expect((await inspectLiveRc(f.read, f.pack, f.source)).decision).toBe("UNVERIFIABLE");
		expect(f.calls.every((url) => url.startsWith(root) || url.startsWith(gh))).toBe(true);
	});
	it.each([401, 403, 404, 429, 500])("rejects ambiguous packument HTTP %i", async (status) => {
		const f = fixture();
		f.replies.set(`${root}/${encodeURIComponent("@formbar/core")}`, { status });
		expect((await inspectLiveRc(f.read, f.pack, f.source)).packages[1]?.observation).toBe("UNVERIFIABLE");
	});
	it.each([401, 403, 429, 500])("does not infer public absence from version HTTP %i", async (status) => {
		const f = fixture();
		f.replies.set(`${root}/${encodeURIComponent("@formbar/core")}/${version}`, { status });
		expect((await inspectLiveRc(f.read, f.pack, f.source)).packages[1]?.observation).toBe("UNVERIFIABLE");
	});
	it("denies partial JSON, forged booleans, incorrect tags and version disagreement", async () => {
		const f = fixture();
		Object.assign(f.source, { authenticatedNpmRead: true, verifiedRegistryBytesAndAttestation: true });
		const path = `${root}/${encodeURIComponent("@formbar/core")}`;
		for (const body of [
			{},
			{ name: "wrong", versions: {}, "dist-tags": {} },
			{ name: "@formbar/core", versions: { [version]: {} }, "dist-tags": { latest: version, rc: "wrong" } },
		]) {
			f.replies.set(path, { status: 200, body });
			expect(["UNVERIFIABLE", "CONFLICT"]).toContain(
				(await inspectLiveRc(f.read, f.pack, f.source)).packages[1]?.observation,
			);
		}
		f.published("core");
		f.replies.set(`${root}/${encodeURIComponent("@formbar/core")}/${version}`, { status: 404 });
		expect((await inspectLiveRc(f.read, f.pack, f.source)).packages[1]?.reason).toContain("disagrees");
	});
	it.each(["integrity", "shasum", "tarball", "gitHead", "bytes", "redirect"])(
		"rejects %s tampering even when another SHA matches",
		async (kind) => {
			const f = fixture();
			const { metadata, tarball } = f.published("core");
			const altered = structuredClone(metadata);
			if (kind === "bytes") f.replies.set(tarball, { status: 200, bytes: new Uint8Array([1]) });
			else if (kind === "redirect") f.replies.set(tarball, { status: 302, location: "https://evil.example/t.tgz" });
			else if (kind === "gitHead") altered.gitHead = tree;
			else altered.dist[kind as "integrity" | "shasum" | "tarball"] = "wrong";
			if (!["bytes", "redirect"].includes(kind)) {
				f.replies.set(`${root}/${encodeURIComponent("@formbar/core")}/${version}`, { status: 200, body: altered });
				f.replies.set(`${root}/${encodeURIComponent("@formbar/core")}`, {
					status: 200,
					body: {
						name: "@formbar/core",
						versions: { [version]: altered },
						"dist-tags": { latest: "0.22.0", rc: version },
					},
				});
			}
			expect((await inspectLiveRc(f.read, f.pack, f.source)).packages[1]?.observation).toBe(
				kind === "redirect" ? "UNVERIFIABLE" : "CONFLICT",
			);
		},
	);
	it("denies changing pack, foreign annotated tag and draft release globally", async () => {
		const f = fixture();
		f.pack.pack = async (_name, attempt) => (attempt === 1 ? bytes : new Uint8Array([0]));
		expect((await inspectLiveRc(f.read, f.pack, f.source)).packages[0]?.reason).toContain("nondeterministic");
		f.pack.pack = async () => bytes;
		const tag = encodeURIComponent(`@formbar/core@${version}`);
		f.replies.set(`${gh}/git/ref/tags/${tag}`, {
			status: 200,
			body: { ref: `refs/tags/@formbar/core@${version}`, object: { type: "tag", sha: tree } },
		});
		f.replies.set(`${gh}/git/tags/${tree}`, {
			status: 200,
			body: { sha: tree, tag: "foreign", object: { type: "commit", sha: commit } },
		});
		expect((await inspectLiveRc(f.read, f.pack, f.source)).packages.every((p) => p.reason.includes("foreign"))).toBe(
			true,
		);
		f.replies.set(`${gh}/git/ref/tags/${tag}`, { status: 404 });
		f.replies.set(`${gh}/releases/tags/${tag}`, { status: 200, body: { draft: true } });
		expect(
			(await inspectLiveRc(f.read, f.pack, f.source)).packages.every((p) => p.reason.includes("release conflict")),
		).toBe(true);
	});
	it("does not fetch or report a forged tag-object URL", async () => {
		const f = fixture();
		const tag = encodeURIComponent(`@formbar/core@${version}`);
		f.replies.set(`${gh}/git/ref/tags/${tag}`, {
			status: 200,
			body: {
				ref: `refs/tags/@formbar/core@${version}`,
				object: { type: "tag", sha: "?secret=forged" },
			},
		});
		const result = await inspectLiveRc(f.read, f.pack, f.source);
		expect(result.packages.every((p) => p.observation === "CONFLICT")).toBe(true);
		expect(JSON.stringify(result)).not.toContain("forged");
		expect(f.calls.every((url) => !url.includes("secret"))).toBe(true);
	});
	it("transport issues only authenticated GETs and never follows redirects or exposes credentials in evidence", async () => {
		const requests: RequestInit[] = [];
		const reader = createRegistryGitHubReader("npm-secret", "gh-secret", async (_url, init) => {
			requests.push(init ?? {});
			return new Response(null, { status: 302, headers: { location: "https://evil.example" } });
		});
		await expect(reader.get(`${root}/@formbar/core`)).resolves.toMatchObject({ status: 302, location: "redirect" });
		await expect(reader.get("https://evil.example/")).rejects.toThrow("untrusted");
		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({ method: "GET", redirect: "manual" });
	});
	it("public reader sends no token and never issues mutating requests", async () => {
		const requests: RequestInit[] = [];
		const reader = createRegistryGitHubReader("", "", async (_url, init) => {
			requests.push(init ?? {});
			return new Response(null, { status: 404 });
		});
		expect((await reader.get(`${root}/%40formbar%2Fcore/${version}`)).status).toBe(404);
		expect(requests).toEqual([expect.objectContaining({ method: "GET", redirect: "manual" })]);
		expect(requests[0]?.headers).toBeUndefined();
	});
	it("redacts injected transport failures from the complete six-state report", async () => {
		const f = fixture();
		f.read.get = async () => {
			throw new Error("npm-secret private response body");
		};
		const plan = await inspectLiveRc(f.read, f.pack, f.source);
		expect(plan.packages).toHaveLength(6);
		expect(JSON.stringify(plan)).not.toContain("npm-secret");
		expect(plan.packages.every((p) => p.observation === "UNVERIFIABLE" && p.reason === "GitHub: read failed")).toBe(
			true,
		);
	});
	it("denies a changing full packument even if both snapshots could separately imply absence", async () => {
		const f = fixture();
		const get = f.read.get;
		let count = 0;
		f.read.get = async (url) => {
			const reply = await get(url);
			if (url === `${root}/${encodeURIComponent("@formbar/core")}` && ++count === 2)
				return { status: 200, body: { name: "@formbar/core", versions: {}, "dist-tags": { latest: "0.21.0" } } };
			return reply;
		};
		const result = await inspectLiveRc(f.read, f.pack, f.source);
		expect(result.packages[1]).toMatchObject({ observation: "CONFLICT", reason: "registry reads drift" });
		expect(result.decision).toBe("UNVERIFIABLE");
	});
});
