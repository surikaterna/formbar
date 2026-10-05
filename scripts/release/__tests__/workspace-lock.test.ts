import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rcPackages } from "../rc-workspace-plan.mjs";
import {
	auditWorkspaceLock,
	compareWorkspaceMetadata,
	parseWorkspaceLock,
	readWorkspaceManifests,
} from "../workspace-lock";

const root = process.cwd();
const fixture = () => ({
	manifests: readWorkspaceManifests(root),
	lock: parseWorkspaceLock(readFileSync("bun.lock", "utf8")),
});

describe("explicit workspace manifest/lock metadata parity", () => {
	it("compares all eleven workspaces including root, private demos and the nine publishable packages", () => {
		const { manifests, lock } = fixture();
		expect(Object.keys(manifests).sort()).toEqual(
			["", "apps/demos", ...rcPackages.map((name) => `packages/${name}`)].sort(),
		);
		expect(compareWorkspaceMetadata(manifests, lock)).toEqual([]);
		expect(auditWorkspaceLock(root)).toEqual({ workspaces: 11, mismatches: [] });
	});
	it.each([
		["packages/from-schema", "@formbar/declarative"],
		["packages/react-schema", "@formbar/declarative"],
		["packages/react-schema", "@formbar/from-schema"],
	])("rejects the audited stale range with identical dependency names: %s -> %s", (path, dependency) => {
		const { manifests, lock } = fixture();
		lock.workspaces[path].dependencies = { ...lock.workspaces[path].dependencies, [dependency]: "^0.23.0-rc.0" };
		expect(compareWorkspaceMetadata(manifests, lock)).toEqual([
			`${path}:dependencies:${dependency}: manifest=^1.0.0-rc.1 lock=^0.23.0-rc.0`,
		]);
	});
	it.each(["", "apps/demos", ...rcPackages.map((name) => `packages/${name}`)])(
		"rejects a missing locked workspace: %s",
		(path) => {
			const { manifests, lock } = fixture();
			lock.workspaces = Object.fromEntries(Object.entries(lock.workspaces).filter(([key]) => key !== path));
			expect(compareWorkspaceMetadata(manifests, lock)).toEqual([`${path || "."}:missing locked workspace`]);
		},
	);
	it("rejects extra lock workspaces and changed versions", () => {
		const { manifests, lock } = fixture();
		lock.workspaces["packages/extra"] = { name: "@formbar/extra", version: "0.0.0" };
		lock.workspaces["packages/fsx-authoring"].version = "0.0.0";
		expect(compareWorkspaceMetadata(manifests, lock)).toHaveLength(2);
	});
	it.each(["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const)(
		"compares missing, extra and changed %s ranges",
		(field) => {
			const manifests = { "": { name: "root", [field]: { missing: "^1.0.0", changed: "^2.0.0" } } };
			const lock = {
				lockfileVersion: 1,
				packages: {},
				workspaces: { "": { name: "root", [field]: { extra: "^1.0.0", changed: "^1.0.0" } } },
			};
			expect(compareWorkspaceMetadata(manifests, lock)).toHaveLength(3);
		},
	);
	it("normalizes key order and Bun optional peer metadata without ignoring it", () => {
		const manifests = {
			"": {
				name: "root",
				dependencies: { a: "1", b: "2" },
				peerDependenciesMeta: { zod: { optional: true }, react: { optional: false } },
			},
		};
		const lock = {
			lockfileVersion: 1,
			packages: {},
			workspaces: { "": { name: "root", dependencies: { b: "2", a: "1" }, optionalPeers: ["zod"] } },
		};
		expect(compareWorkspaceMetadata(manifests, lock)).toEqual([]);
		lock.workspaces[""].optionalPeers = [];
		expect(compareWorkspaceMetadata(manifests, lock)).toEqual([".:optionalPeers differs"]);
	});
	it("parses trailing commas/comments structurally and rejects malformed or unsupported locks", () => {
		expect(
			parseWorkspaceLock('{ "lockfileVersion": 1, /* Bun JSONC */ "workspaces": {}, "packages": {}, }').workspaces,
		).toEqual({});
		for (const source of ["{", '{"lockfileVersion":2,"workspaces":{}}', '{"lockfileVersion":1,"workspaces":[]}'])
			expect(() => parseWorkspaceLock(source)).toThrow();
	});
});
