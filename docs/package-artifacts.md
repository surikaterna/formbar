# Package artifact policy

Formbar packages publish built runtime JavaScript, declarations, and their source maps. They do not publish raw `src`, tests, fixtures, build configuration, or workspace files. npm's standard metadata files (`package.json`, `README.md`, and `LICENSE`) are included in every package. `@formbar/expressions` additionally publishes the ADR linked from its README.

Source maps are an intentional debugging contract. Map source names must be relative paths to production source in the same package, every source must have matching `sourcesContent`, and no test, dependency, checkout path, or local configuration may appear. The embedded production source makes each map self-contained without widening the package allowlist to raw source trees.

`bun run check:package-artifacts` is the authoritative gate. It delegates file selection to native `npm pack --dry-run --json` and `npm pack --json`, validates package metadata and export targets, audits source maps and package-local license copies, then performs two independent clean builds. The two native npm tarballs for each package must have identical file lists and raw bytes. This check intentionally uses npm rather than `bun pack` because npm defines the publication semantics.

The package-local `LICENSE` files are synchronized copies of the repository-root license. Any license change must update all seven copies in the same change; the artifact gate compares their bytes.

All ten public entries use ordered `import: { types: .d.ts, default: .js }` and `require: { types: .d.cts, default: .cjs }` conditions. The gate rejects outer `types`/`default`, reordered or missing conditions, missing packed targets, incorrect extension pairs and legacy root metadata drift. Conditional type recognition requires TypeScript >=4.7; the enforced consumer matrix uses TypeScript 5.7.3.

`bun run check:consumer-exports` independently packs all seven freshly built packages with native `npm pack` into an external temporary project (never workspace links). With React 18 and React 19 separately, it checks strict NodeNext ESM and CJS namespace imports, CJS `import = require`, and Bundler imports without `skipLibCheck`, asserts each of the ten resolution targets and the Arbitre/Kuery declaration branches have the appropriate extension, typechecks representative upstream Arbiter types, and compares Node import/require runtime export keys. Run it after a clean `bun run build`; CI does so after removing package `dist` directories.
