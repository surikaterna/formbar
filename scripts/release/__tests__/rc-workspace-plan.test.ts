import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { consumed, initialVersions } from "../rc-reviewed-plan";
import {
	checkProductionDeclarations,
	checkRcManifests,
	kaladaProductionDependencies,
	rcEdges,
	rcPackages,
	readRcPlan,
} from "../rc-workspace-plan.mjs";

describe("active nine-package RC closure", () => {
	it("pins the reviewed dependency-first public package order", () => {
		expect(rcPackages).toEqual([
			"expressions",
			"core",
			"declarative",
			"fsx-authoring",
			"fsx-editor",
			"from-schema",
			"react",
			"arbiter",
			"react-schema",
		]);
		for (const [index, name] of rcPackages.entries())
			for (const dependency of rcEdges[name]) expect(rcPackages.indexOf(dependency)).toBeLessThan(index);
	});
	it("declares sibling package imports so published bundles cannot embed another workspace's source maps", () => {
		for (const name of rcPackages) {
			const manifest = JSON.parse(readFileSync(`packages/${name}/package.json`, "utf8"));
			const root = `packages/${name}/src`;
			for (const file of readdirSync(root, { recursive: true, encoding: "utf8" })) {
				if (file.includes("__tests__") || !/\.tsx?$/.test(file)) continue;
				const source = ts.createSourceFile(file, readFileSync(`${root}/${file}`, "utf8"), ts.ScriptTarget.Latest, true);
				for (const statement of source.statements) {
					const specifier =
						(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier;
					if (!specifier || !ts.isStringLiteral(specifier)) continue;
					const match = /^(@formbar\/[^/]+)/.exec(specifier.text);
					if (!match || match[1] === manifest.name) continue;
					expect(manifest.dependencies[match[1]], `${name}/${file}: ${match[1]}`).toBeDefined();
				}
			}
		}
	});
	it("rejects react-schema's formerly undeclared expressions runtime edge", () => {
		const manifests = rcPackages.map((name) => JSON.parse(readFileSync(`packages/${name}/package.json`, "utf8")));
		Reflect.deleteProperty(
			manifests.find(({ name }) => name === "@formbar/react-schema").dependencies,
			"@formbar/expressions",
		);
		expect(() => checkRcManifests(manifests)).toThrow(/dependency graph: react-schema/);
	});
	it("assigns every current direct production Kalada import to its manifest owner", () => {
		for (const name of rcPackages) {
			const root = `packages/${name}/src`;
			const imports = new Set<string>();
			for (const file of readdirSync(root, { recursive: true, encoding: "utf8" })) {
				if (file.includes("__tests__") || !/\.tsx?$/.test(file)) continue;
				for (const match of readFileSync(`${root}/${file}`, "utf8").matchAll(/from\s+["'](@kalada\/[^"']+)["']/g))
					imports.add(match[1]);
			}
			expect([...imports].sort()).toEqual(Object.keys(kaladaProductionDependencies[`@formbar/${name}`] ?? {}).sort());
		}
	});
	it("holds production publishing until direct Kalada dependencies can be installed normally", () => {
		const manifests = rcPackages.map((name) => JSON.parse(readFileSync(`packages/${name}/package.json`, "utf8")));
		const pending = structuredClone(manifests);
		pending.find(({ name }) => name === "@formbar/declarative").dependencies["@kalada/core"] = undefined;
		expect(() => checkProductionDeclarations(pending)).toThrow(/production registry gate/);
		for (const manifest of manifests) Object.assign(manifest.dependencies, kaladaProductionDependencies[manifest.name]);
		expect(() => checkProductionDeclarations(manifests)).not.toThrow();
		manifests.find(({ name }) => name === "@formbar/declarative").dependencies["@kalada/syntax"] = undefined;
		expect(() => checkProductionDeclarations(manifests)).toThrow(/directly declare @kalada\/syntax/);
	});
	it("preserves consumed main history and uses the separate FSX initial version", () => {
		const manifests = readRcPlan(process.cwd());
		expect(manifests.map(({ name }) => name.slice(9))).toEqual(rcPackages);
		expect(manifests.find(({ name }) => name === "@formbar/fsx-authoring")?.version).toBe("0.1.0-rc.1");
		expect(manifests.find(({ name }) => name === "@formbar/fsx-editor")?.version).toBe("0.1.0-rc.0");
		expect(manifests.find(({ name }) => name === "@formbar/fsx-editor")?.dependencies).toEqual({
			"@formbar/fsx-authoring": "^0.1.0-rc.1",
		});
		const pre = JSON.parse(readFileSync(".changeset/pre.json", "utf8"));
		expect(pre.initialVersions).toMatchObject(initialVersions);
		expect(pre.initialVersions["@formbar/fsx-authoring"]).toBe("0.0.0");
		expect(pre.initialVersions["@formbar/fsx-editor"]).toBe("0.0.0");
		expect(pre.changesets).toContain("fsx-syntax-highlighting");
		for (const id of consumed) expect(pre.changesets).toContain(id);
		for (const name of rcPackages.filter((name) => !name.startsWith("fsx-")))
			expect(readFileSync(`packages/${name}/CHANGELOG.md`, "utf8")).toContain("## 0.23.0-rc.0");
	});
	it("rejects missing, duplicate, extra, stable and wrong-channel packages", () => {
		const manifests = readRcPlan(process.cwd());
		for (const changed of [
			manifests.slice(1),
			[...manifests.slice(1), manifests[1]],
			[...manifests, { name: "@formbar/extra", version: "0.1.0-rc.0" }],
			manifests.map((manifest) =>
				manifest.name === "@formbar/fsx-editor" ? { ...manifest, name: "@formbar/other" } : manifest,
			),
			manifests.map((manifest) =>
				manifest.name === "@formbar/fsx-editor" ? { ...manifest, private: true } : manifest,
			),
			...["0.1.0", "0.1.0-beta.0", "0.1.0-rc.01"].map((version) =>
				manifests.map((manifest) => (manifest.name === "@formbar/fsx-authoring" ? { ...manifest, version } : manifest)),
			),
		])
			expect(() => checkRcManifests(changed)).toThrow();
	});
	it("rejects incompatible editor dependency floors and missing authoring edges", () => {
		for (const range of [undefined, "^0.0.0", "^0.1.0", "^0.1.0-rc.2", "0.1.0-rc.1"]) {
			const manifests = readRcPlan(process.cwd());
			const editor = manifests.find(({ name }) => name === "@formbar/fsx-editor");
			if (range === undefined) Reflect.deleteProperty(editor.dependencies, "@formbar/fsx-authoring");
			else editor.dependencies["@formbar/fsx-authoring"] = range;
			expect(() => checkRcManifests(manifests)).toThrow(/dependency graph/);
		}
	});
	it("rejects stale FSX Formbar edges rather than resolving old registry implementations", () => {
		const manifests = rcPackages.map((name) => JSON.parse(readFileSync(`packages/${name}/package.json`, "utf8")));
		for (const range of ["^0.14.3", "^0.23.0", "^0.23.0-rc.99", "0.23.0-rc.0"]) {
			const changed = structuredClone(manifests);
			changed.find(({ name }) => name === "@formbar/fsx-authoring").dependencies["@formbar/expressions"] = range;
			expect(() => checkRcManifests(changed)).toThrow(/dependency graph/);
		}
	});
});
