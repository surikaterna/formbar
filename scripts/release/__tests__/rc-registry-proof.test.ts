import { describe, expect, it } from "vitest";
import { type RcRead, type Reply, type SourceWitness, inspectExchange, inspectRcRegistry } from "../rc-registry-proof";
import { consumed } from "../rc-source-check";

const names = ["arbiter", "core", "declarative", "from-schema", "react", "react-schema"];
const hash = "a".repeat(40);
const tree = "b".repeat(40);
const integrity = `sha512-${"A".repeat(86)}==`;
const tag = "0.23.0-rc.0";
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
		commit: hash,
		tree,
		pre: { mode: "pre", tag: "rc", changesets: consumed, initialVersions: { "@formbar/expressions": "0.14.3" } },
		manifests: { expressions: { name: "@formbar/expressions", version: "0.14.3" } },
		changelogs: {},
		artifacts: {},
		initialLatest: {},
		publisher: {},
	};
	const replies = new Map<string, Reply>();
	replies.set(`/repos/surikaterna/formbar/commits/${hash}`, { status: 200, body: { commit: { tree: { sha: tree } } } });
	for (const name of names) {
		const pkg = `@formbar/${name}`;
		source.manifests[name] = {
			name: pkg,
			version: tag,
			dependencies: Object.fromEntries(edges[name].map((edge) => [`@formbar/${edge}`, `^${tag}`])),
		};
		source.changelogs[name] = `## ${tag}\n\nNotes for ${name}`;
		source.initialLatest[name] = "0.22.0";
		if (source.publisher)
			source.publisher[name] = {
				repository: "surikaterna/formbar",
				workflow: "release.yml",
				environment: "formbar-rc",
				authenticatedNpmRead: true,
			};
		const tarball = `https://registry.npmjs.org/${encodeURIComponent(pkg)}/-/${name}-${tag}.tgz`;
		const provenance = {
			subjectIntegrity: integrity,
			repository: "surikaterna/formbar",
			commit: hash,
			workflow: "release.yml",
		};
		source.artifacts[name] = {
			name: pkg,
			version: tag,
			commit: hash,
			integrity,
			shasum: hash,
			tarball,
			provenance,
			verifiedRegistryBytesAndAttestation: true,
		};
		const encoded = encodeURIComponent(pkg);
		replies.set(`https://registry.npmjs.org/${encoded}/${tag}`, { status: 404 });
		replies.set(`https://registry.npmjs.org/-/package/${encoded}/dist-tags`, {
			status: 200,
			body: { latest: "0.22.0" },
		});
		replies.set(`/repos/surikaterna/formbar/git/ref/tags/${encodeURIComponent(`${pkg}@${tag}`)}`, { status: 404 });
		replies.set(`/repos/surikaterna/formbar/releases/tags/${encodeURIComponent(`${pkg}@${tag}`)}`, { status: 404 });
	}
	const reads: string[] = [];
	const read: RcRead = {
		get: async (path) => {
			reads.push(path);
			return replies.get(path) ?? { status: 403 };
		},
	};
	function published(name: string) {
		const pkg = `@formbar/${name}`;
		const artifact = source.artifacts[name];
		if (!artifact) throw new Error("fixture artifact missing");
		replies.set(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/${tag}`, {
			status: 200,
			body: {
				name: pkg,
				version: tag,
				gitHead: hash,
				dist: { integrity, shasum: hash, tarball: artifact.tarball, provenance: artifact.provenance },
			},
		});
		replies.set(`https://registry.npmjs.org/-/package/${encodeURIComponent(pkg)}/dist-tags`, {
			status: 200,
			body: { latest: "0.22.0", rc: tag },
		});
	}
	return { source, replies, read, reads, published };
}
const versionPath = (name: string) => `https://registry.npmjs.org/${encodeURIComponent(`@formbar/${name}`)}/${tag}`;

describe("#366 read-only rc reconciliation", () => {
	it("reports absent, same-SHA partial recovery, and identical without writes", async () => {
		const f = fixture();
		expect((await inspectRcRegistry(f.read, f.source)).state).toBe("absent");
		f.published("core");
		const partial = await inspectRcRegistry(f.read, f.source);
		expect(partial.state).toBe("partial-same-sha");
		expect(partial.blocked.join()).toContain("fresh #250 FINAL GO");
		for (const name of names) f.published(name);
		expect(await inspectRcRegistry(f.read, f.source)).toMatchObject({ state: "identical", remaining: [], blocked: [] });
		expect(f.reads.every((path) => !/POST|PUT|PATCH|DELETE/.test(path))).toBe(true);
	});
	it.each([401, 403, 500])("denies registry error %i rather than treating it as 404", async (status) => {
		const f = fixture();
		f.replies.set(versionPath("core"), { status });
		await expect(inspectRcRegistry(f.read, f.source)).rejects.toThrow("GET failed");
	});
	it.each(["gitHead", "integrity", "tarball", "provenance"])(
		"rejects mismatched %s even on the same SHA",
		async (field) => {
			const f = fixture();
			f.published("arbiter");
			const reply = f.replies.get(versionPath("arbiter"));
			if (!reply) throw new Error("fixture version missing");
			const body = reply.body as { gitHead: string | undefined; dist: Record<string, unknown> };
			if (field === "gitHead") body.gitHead = undefined;
			else if (field === "provenance") body.dist.provenance = undefined;
			else body.dist[field] = "wrong";
			await expect(inspectRcRegistry(f.read, f.source)).rejects.toThrow();
		},
	);
	it("rejects matching metadata when tarball bytes or attestation cannot be independently verified", async () => {
		const f = fixture();
		f.published("arbiter");
		const artifact = f.source.artifacts.arbiter;
		if (!artifact) throw new Error("fixture artifact missing");
		artifact.verifiedRegistryBytesAndAttestation = false;
		await expect(inspectRcRegistry(f.read, f.source)).rejects.toThrow("UNVERIFIABLE");
	});
	it("denies range, latest, rc and unknown publisher", async () => {
		const f = fixture();
		const react = f.source.manifests.react as { dependencies: Record<string, string> };
		react.dependencies["@formbar/core"] = "^0.23.0";
		await expect(inspectRcRegistry(f.read, f.source)).rejects.toThrow("edge");
		react.dependencies["@formbar/core"] = `^${tag}`;
		f.replies.set(`https://registry.npmjs.org/-/package/${encodeURIComponent("@formbar/arbiter")}/dist-tags`, {
			status: 200,
			body: { latest: tag, rc: "wrong" },
		});
		await expect(inspectRcRegistry(f.read, f.source)).rejects.toThrow("latest");
		f.replies.set(`https://registry.npmjs.org/-/package/${encodeURIComponent("@formbar/arbiter")}/dist-tags`, {
			status: 200,
			body: { latest: "0.22.0", rc: "wrong" },
		});
		await expect(inspectRcRegistry(f.read, f.source)).rejects.toThrow("rc dist-tag");
		f.replies.set(`https://registry.npmjs.org/-/package/${encodeURIComponent("@formbar/arbiter")}/dist-tags`, {
			status: 200,
			body: { latest: "0.22.0" },
		});
		if (f.source.publisher) f.source.publisher.arbiter = undefined;
		expect((await inspectRcRegistry(f.read, f.source)).blocked).toContain("publisher arbiter UNVERIFIABLE");
	});
	it("denies lightweight tag, draft release and wrong tree", async () => {
		const f = fixture();
		const tagName = "@formbar/arbiter@0.23.0-rc.0";
		const refPath = `/repos/surikaterna/formbar/git/ref/tags/${encodeURIComponent(tagName)}`;
		f.replies.set(refPath, { status: 200, body: { ref: tagName, object: { type: "commit", sha: hash } } });
		await expect(inspectRcRegistry(f.read, f.source)).rejects.toThrow("lightweight");
		f.replies.set(refPath, { status: 404 });
		f.replies.set(`/repos/surikaterna/formbar/releases/tags/${encodeURIComponent(tagName)}`, {
			status: 200,
			body: { draft: true },
		});
		await expect(inspectRcRegistry(f.read, f.source)).rejects.toThrow("release");
		f.source.tree = hash;
		await expect(inspectRcRegistry(f.read, f.source)).rejects.toThrow("tree");
	});
	it("requires annotated tag object to resolve to the audited commit and exact release notes", async () => {
		const f = fixture();
		f.published("arbiter");
		const tagName = "@formbar/arbiter@0.23.0-rc.0";
		const refPath = `/repos/surikaterna/formbar/git/ref/tags/${encodeURIComponent(tagName)}`;
		const objectPath = `/repos/surikaterna/formbar/git/tags/${tree}`;
		f.replies.set(refPath, { status: 200, body: { ref: `refs/tags/${tagName}`, object: { type: "tag", sha: tree } } });
		f.replies.set(objectPath, {
			status: 200,
			body: { sha: tree, tag: tagName, object: { type: "commit", sha: hash } },
		});
		const releasePath = `/repos/surikaterna/formbar/releases/tags/${encodeURIComponent(tagName)}`;
		f.replies.set(releasePath, {
			status: 200,
			body: {
				tag_name: tagName,
				name: `@formbar/arbiter ${tag}`,
				draft: false,
				prerelease: true,
				body: "Notes for arbiter",
			},
		});
		expect((await inspectRcRegistry(f.read, f.source)).state).toBe("partial-same-sha");
		f.replies.set(objectPath, {
			status: 200,
			body: { sha: tree, tag: tagName, object: { type: "commit", sha: tree } },
		});
		await expect(inspectRcRegistry(f.read, f.source)).rejects.toThrow("foreign annotated tag");
		f.replies.set(objectPath, {
			status: 200,
			body: { sha: tree, tag: tagName, object: { type: "commit", sha: hash } },
		});
		f.replies.set(releasePath, {
			status: 200,
			body: { tag_name: tagName, name: `@formbar/arbiter ${tag}`, draft: false, prerelease: true, body: "wrong" },
		});
		await expect(inspectRcRegistry(f.read, f.source)).rejects.toThrow("release");
	});
	it("only models a short-lived OIDC response; no exchange request", () => {
		expect(inspectExchange("@formbar/core", { status: 403 })).toBe(false);
		expect(inspectExchange("@formbar/expressions", { status: 201, body: {} })).toBe(false);
		expect(
			inspectExchange("@formbar/core", {
				status: 201,
				body: { token_type: "oidc", token: "mock", created: "2026-01-01", expires: "2026-01-02" },
			}),
		).toBe(true);
	});
});
