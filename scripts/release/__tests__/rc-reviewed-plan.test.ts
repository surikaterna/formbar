import { expect, test } from "vitest";
import {
	checkManifest,
	checkPre,
	consumed,
	initialVersions,
	rcEdges,
	rcPackages,
	rcVersion,
} from "../rc-reviewed-plan";

const pre = () => ({ mode: "pre", tag: "rc", initialVersions, changesets: [...consumed] });
const manifest = (name: string) => ({
	name: `@formbar/${name}`,
	version: rcVersion,
	dependencies: Object.fromEntries(rcEdges[name].map((edge) => [`@formbar/${edge}`, `^${rcVersion}`])),
});

test("seven exact linked prerelease packages and all 23 consumed IDs", () => {
	expect(rcPackages).toHaveLength(7);
	expect(consumed).toHaveLength(23);
	expect(consumed).toContain("reference-codec");
	checkPre(pre());
	for (const name of rcPackages) checkManifest(name, manifest(name));
});

test("six-only, 22 IDs, reordered/extra IDs, stable mode and missing expressions RC fail closed", () => {
	for (const ids of [
		consumed.filter((id) => id !== "reference-codec"),
		[...consumed].reverse(),
		[...consumed, "held-kalada"],
	])
		expect(() => checkPre({ ...pre(), changesets: ids })).toThrow("consumed IDs");
	expect(() => checkPre({ ...pre(), mode: "exit" })).toThrow("prerelease");
	expect(() => checkManifest("unknown", manifest("core"))).toThrow("manifest");
	expect(() => checkManifest("expressions", { ...manifest("expressions"), version: "0.14.3" })).toThrow("manifest");
	const core = manifest("core");
	expect(() => checkManifest("core", { ...core, dependencies: {} })).toThrow("dependency graph");
	expect(() => checkManifest("core", { ...core, dependencies: { "@formbar/expressions": "^0.14.3" } })).toThrow(
		"dependency graph",
	);
	expect(() =>
		checkManifest("core", { ...core, dependencies: { ...core.dependencies, "@formbar/arbiter": `^${rcVersion}` } }),
	).toThrow("dependency graph");
});
