# Package artifact policy

Formbar packages publish built runtime JavaScript, declarations, and their source maps. They do not publish raw `src`, tests, fixtures, build configuration, or workspace files. npm's standard metadata files (`package.json`, `README.md`, and `LICENSE`) are included in every package. `@formbar/expressions` additionally publishes the ADR linked from its README.

Source maps are an intentional debugging contract. Map source names must be relative paths to production source in the same package, every source must have matching `sourcesContent`, and no test, dependency, checkout path, or local configuration may appear. The embedded production source makes each map self-contained without widening the package allowlist to raw source trees.

`bun run check:package-artifacts` is the authoritative gate. It delegates file selection to native `npm pack --dry-run --json` and `npm pack --json`, validates package metadata and export targets, audits source maps and package-local license copies, then performs two independent clean builds. The two native npm tarballs for each package must have identical file lists and raw bytes. This check intentionally uses npm rather than `bun pack` because npm defines the publication semantics.

The package-local `LICENSE` files are synchronized copies of the repository-root license. Any license change must update all seven copies in the same change; the artifact gate compares their bytes.
