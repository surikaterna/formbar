import { execFile } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const binaryDirectory = join(repositoryRoot, "node_modules", ".bin");
const commandEnvironment = { ...process.env, PATH: `${binaryDirectory}:${process.env.PATH ?? ""}` };

const manifests = {
	alpha: {
		name: "@fixture/alpha",
		version: "1.0.0",
		files: ["dist"],
	},
	beta: {
		name: "@fixture/beta",
		version: "1.0.0",
		files: ["dist"],
		dependencies: { "@fixture/alpha": "^1.0.0" },
	},
};

async function repositoryVersionScript(): Promise<string> {
	const manifest = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));
	return manifest.scripts["version:packages"];
}

async function createFixture(versionScript: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "version-command-"));
	await mkdir(join(root, ".changeset"));
	await mkdir(join(root, "packages", "alpha"), { recursive: true });
	await mkdir(join(root, "packages", "beta"), { recursive: true });
	await writeFile(
		join(root, "package.json"),
		JSON.stringify({ private: true, workspaces: ["packages/*"], scripts: { "version:packages": versionScript } }),
	);
	await writeFile(join(root, "biome.json"), await readFile(join(repositoryRoot, "biome.json"), "utf8"));
	await writeFile(
		join(root, ".changeset", "config.json"),
		JSON.stringify({
			changelog: false,
			commit: false,
			fixed: [],
			linked: [],
			access: "restricted",
			baseBranch: "main",
			updateInternalDependencies: "patch",
			ignore: [],
		}),
	);
	await writeFile(
		join(root, ".changeset", "fixture.md"),
		'---\n"@fixture/alpha": major\n---\n\nExercise version formatting.\n',
	);
	for (const [directory, manifest] of Object.entries(manifests)) {
		await writeFile(join(root, "packages", directory, "package.json"), JSON.stringify(manifest));
	}
	return root;
}

async function readManifests(root: string) {
	const entries = await Promise.all(
		Object.keys(manifests).map(async (directory) => {
			const contents = await readFile(join(root, "packages", directory, "package.json"), "utf8");
			return [directory, { contents, parsed: JSON.parse(contents) }] as const;
		}),
	);
	return Object.fromEntries(entries);
}

async function readPre(root: string) {
	return readFile(join(root, ".changeset", "pre.json"), "utf8");
}

describe("version:packages", () => {
	it("preserves Changesets semantics while formatting generated manifests", async () => {
		const versionScript = await repositoryVersionScript();
		const roots = [await createFixture(versionScript), await createFixture(versionScript)];
		try {
			const [rawRoot, formattedRoot] = roots;
			const packagePaths = ["packages/alpha/package.json", "packages/beta/package.json"];
			expect(await readFile(join(rawRoot, "packages", "alpha", "package.json"), "utf8")).toContain('"files":["dist"]');

			await execute(join(binaryDirectory, "changeset"), ["version"], { cwd: rawRoot, env: commandEnvironment });
			await execute("bun", ["run", "version:packages"], { cwd: formattedRoot, env: commandEnvironment });

			const raw = await readManifests(rawRoot);
			const formatted = await readManifests(formattedRoot);
			expect({ alpha: formatted.alpha.parsed, beta: formatted.beta.parsed }).toEqual({
				alpha: raw.alpha.parsed,
				beta: raw.beta.parsed,
			});
			expect(formatted.alpha.parsed).toMatchObject({ version: "2.0.0", files: ["dist"] });
			expect(formatted.beta.parsed).toMatchObject({
				version: "1.0.1",
				dependencies: { "@fixture/alpha": "^2.0.0" },
			});

			await execute(join(binaryDirectory, "biome"), ["format", ...packagePaths], {
				cwd: formattedRoot,
				env: commandEnvironment,
			});
			const beforeSecondFormat = { alpha: formatted.alpha.contents, beta: formatted.beta.contents };
			await execute(join(binaryDirectory, "biome"), ["format", "--write", ...packagePaths], {
				cwd: formattedRoot,
				env: commandEnvironment,
			});
			const afterSecondFormat = await readManifests(formattedRoot);
			expect({ alpha: afterSecondFormat.alpha.contents, beta: afterSecondFormat.beta.contents }).toEqual(
				beforeSecondFormat,
			);
			await Promise.all(roots.map((root) => expect(access(join(root, ".changeset", "pre.json"))).rejects.toThrow()));

			await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
			await Promise.all(roots.map((root) => expect(access(root)).rejects.toThrow()));
			roots.length = 0;
		} finally {
			await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
		}
	}, 15_000);

	it("formats only generated prerelease metadata without changing Changesets output", async () => {
		const versionScript = await repositoryVersionScript();
		const roots = [await createFixture(versionScript), await createFixture(versionScript)];
		try {
			const [rawRoot, formattedRoot] = roots;
			await execute(join(binaryDirectory, "biome"), ["format", "--write", "."], {
				cwd: formattedRoot,
				env: commandEnvironment,
			});
			for (const root of roots) {
				await execute(join(binaryDirectory, "changeset"), ["pre", "enter", "rc"], {
					cwd: root,
					env: commandEnvironment,
				});
			}
			await execute(join(binaryDirectory, "changeset"), ["version"], { cwd: rawRoot, env: commandEnvironment });
			await execute("bun", ["run", "version:packages"], { cwd: formattedRoot, env: commandEnvironment });

			const rawPre = await readPre(rawRoot);
			const formattedPre = await readPre(formattedRoot);
			expect(JSON.parse(formattedPre)).toEqual(JSON.parse(rawPre));
			expect(JSON.parse(formattedPre)).toMatchObject({ mode: "pre", tag: "rc", changesets: ["fixture"] });
			const raw = await readManifests(rawRoot);
			const formatted = await readManifests(formattedRoot);
			expect(formatted).toMatchObject({
				alpha: { parsed: { version: "2.0.0-rc.0" } },
				beta: { parsed: { dependencies: { "@fixture/alpha": "^2.0.0-rc.0" } } },
			});
			expect({ alpha: formatted.alpha.parsed, beta: formatted.beta.parsed }).toEqual({
				alpha: raw.alpha.parsed,
				beta: raw.beta.parsed,
			});
			await expect(
				execute(join(binaryDirectory, "biome"), ["check", "."], {
					cwd: formattedRoot,
					env: commandEnvironment,
				}),
			).resolves.toBeDefined();

			const beforeSecondVersion = { pre: formattedPre, manifests: await readManifests(formattedRoot) };
			await execute("bun", ["run", "version:packages"], { cwd: formattedRoot, env: commandEnvironment });
			expect({ pre: await readPre(formattedRoot), manifests: await readManifests(formattedRoot) }).toEqual(
				beforeSecondVersion,
			);
		} finally {
			await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
		}
	}, 15_000);

	it("fails when prerelease formatting fails instead of silently accepting invalid metadata", async () => {
		const root = await createFixture(await repositoryVersionScript());
		try {
			await execute(join(binaryDirectory, "changeset"), ["pre", "enter", "rc"], {
				cwd: root,
				env: commandEnvironment,
			});
			const fixtureBin = join(root, "node_modules", ".bin");
			await mkdir(fixtureBin, { recursive: true });
			const fakeBiome = join(fixtureBin, "biome");
			const invocations = join(root, "biome-invocations");
			await writeFile(
				fakeBiome,
				`#!/bin/sh\nprintf '<%s>' "$@" >> "${invocations}"\nprintf '\\n' >> "${invocations}"\nif [ "$#" -eq 3 ] && [ "$1" = format ] && [ "$2" = --write ] && [ "$3" = .changeset/pre.json ]; then exit 42; fi\nexec "${join(binaryDirectory, "biome")}" "$@"\n`,
			);
			await chmod(fakeBiome, 0o755);
			await expect(
				execute("bun", ["run", "version:packages"], {
					cwd: root,
					env: { ...commandEnvironment, PATH: `${fixtureBin}:${commandEnvironment.PATH}` },
				}),
			).rejects.toMatchObject({ code: 42 });
			expect(await readFile(invocations, "utf8")).toContain("<format><--write><.changeset/pre.json>\n");
			expect(JSON.parse(await readPre(root)).changesets).toEqual(["fixture"]);
		} finally {
			await rm(root, { recursive: true, force: true });
			await expect(access(root)).rejects.toThrow();
		}
	}, 15_000);
});
