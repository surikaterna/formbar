import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { workspaceSourceModules } from "./workspace-source-aliases";

interface PackageManifest {
	readonly name: string;
	readonly exports?: Readonly<Record<string, unknown>>;
	readonly dependencies?: Readonly<Record<string, string>>;
	readonly devDependencies?: Readonly<Record<string, string>>;
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifests = readdirSync(join(root, "packages"), { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map(
		(entry) => JSON.parse(readFileSync(join(root, "packages", entry.name, "package.json"), "utf8")) as PackageManifest,
	);
const workspaceNames = new Set(manifests.map((manifest) => manifest.name));

describe("workspace source resolution", () => {
	it("maps every workspace package export used by tests to a source file", () => {
		for (const manifest of manifests) {
			for (const subpath of Object.keys(manifest.exports ?? { ".": true })) {
				const specifier = subpath === "." ? manifest.name : `${manifest.name}${subpath.slice(1)}`;
				const source = workspaceSourceModules[specifier as keyof typeof workspaceSourceModules];
				expect(source, specifier).toBeTruthy();
				if (!source) throw new Error(`Missing source alias for ${specifier}`);
				expect(fileURLToPath(source), specifier).toContain("/src/");
				expect(existsSync(fileURLToPath(source)), specifier).toBe(true);
			}
		}
	});

	it("covers every workspace dependency edge", () => {
		for (const manifest of manifests) {
			const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
			for (const dependency of Object.keys(dependencies).filter((name) => workspaceNames.has(name))) {
				expect(
					workspaceSourceModules[dependency as keyof typeof workspaceSourceModules],
					`${manifest.name} -> ${dependency}`,
				).toBeTruthy();
			}
		}
	});

	it("loads declarative, from-schema, and react-schema through source aliases", async () => {
		const [declarative, fromSchema, reactSchema] = await Promise.all([
			import("@formbar/declarative"),
			import("@formbar/from-schema"),
			import("@formbar/react-schema"),
		]);
		expect(declarative.validateFormDefinition).toBeTypeOf("function");
		expect(fromSchema.projectSchema).toBeTypeOf("function");
		expect(reactSchema.useSchemaForm).toBeTypeOf("function");
	});
});
